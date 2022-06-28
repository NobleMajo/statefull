import { IncomingMessage, Server as HttpServer } from "http"
import fetch, { RequestInit, Response } from "node-fetch"
import {
    Server as WebSocketServer,
    WebSocket,
} from "ws"
import { createSecretHash } from "./hash"
import { Node, StatefullNodeSettings, WsEndpoint, SocketData, StatefullNodeOptions, defaultStatefullApiSettings } from './types';
import { Application } from "express"
import * as express from 'express';
import * as JWT from 'jsonwebtoken';
import { StatefullExportSettings, StatefullNodeExportSettings } from 'statefull-api/dist/types';

export let lastWsNumber: number = 0

export function getWebSocketEndpoint(
    sock: WebSocket,
    req: IncomingMessage,
    behindProxy: boolean,
): WsEndpoint {
    let address: string
    if (behindProxy) {
        address = (
            req.headers["x-forwarded-for"] ??
            req.headers["CF-Connecting-IP"] ??
            req.headers["True-Client-IP"] ??
            req.socket.remoteAddress
        ) as any
        if (Array.isArray(address)) {
            if (address.length == 0) {
                address = undefined
            } else {
                address = address[0]
            }
        }
    } else {
        address = req.socket.remoteAddress
    }
    if (
        typeof address != "string" ||
        address.length == 0
    ) {
        throw new Error("Can't get websocket remote address")
    }
    let port: number
    if (behindProxy) {
        port = (
            req.headers["x-forwarded-port"] ??
            req.headers["CF-Connecting-Port"] ??
            req.headers["True-Client-Port"] ??
            req.socket.remotePort
        ) as any
        if (Array.isArray(port)) {
            if (port.length == 0) {
                port = undefined
            } else {
                port = port[0]
            }
        }
        port = Number(port)
    } else {
        port = Number(req.socket.remotePort)
    }
    if (isNaN(port)) {
        throw new Error("Can't get websocket remote port")
    }
    return {
        address,
        port,
        id: address + ":" + port,
        nid: lastWsNumber++,
    }
}

export class StatefullNode {
    settings: StatefullNodeSettings
    nodeSettings: StatefullNodeExportSettings
    express: Application
    httpServer: HttpServer
    wsServer: WebSocketServer<WebSocket>
    running: boolean = false
    ready: boolean = true
    node: Node | undefined

    heartbeatId: number
    sockets: {
        [id: string]: SocketData
    } = {}

    constructor(
        options: StatefullNodeOptions
    ) {
        this.settings = {
            ...defaultStatefullApiSettings,
            ...options,
            wsOptions: {
                ...defaultStatefullApiSettings.wsOptions,
                ...options.wsOptions,
            },
        }
    }

    async fetchBaseApiSettings(): Promise<StatefullExportSettings> {
        const resp = await fetch(
            this.settings.apiUrl + "/statefull.json",
        )
        if (resp.status != 200) {
            throw new Error(
                "fetchBaseApiSettings(): Status is not 200 on " +
                this.settings.apiUrl + "/statefull.json" + ":\n" +
                resp.status + ": " + resp.statusText + ":\n" +
                await resp.text()
            )
        }
        const data: StatefullNodeExportSettings = await resp.json()
        if (
            typeof data.externalUrl != "string"
        ) {
            throw new Error("Invalid export settings.\n'externalUrl' is not a string")
        }
        if (
            typeof data.nodeHashIterations != "number"
        ) {
            throw new Error("Invalid export settings.\n'nodeHashIterations' is not a number")
        }
        if (
            typeof data.nodeHashAlgorithm != "string"
        ) {
            throw new Error("Invalid export settings.\n'nodeHashAlgorithm' is not a string")
        }
        if (
            typeof data.jwtRequestPrefix != "string"
        ) {
            throw new Error("Invalid export settings.\n'jwtRequestPrefix' is not a string")
        }
        while (data.externalUrl.endsWith("/")) {
            data.externalUrl = data.externalUrl.slice(0, -1)
        }
        return data
    }

    async fetchNodeSettings(): Promise<StatefullNodeExportSettings> {
        try {
            if (!this.nodeSettings) {
                this.nodeSettings = (
                    await this.fetchBaseApiSettings()
                ) as any
            }
            const resp = await this.apiFetch(
                "/node/statefull.json",
                {
                    method: "get",
                }
            )
            if (resp.status != 200) {
                throw new Error(
                    "fetchNodeSettings(): Status is not 200 on " +
                    this.settings.apiUrl + "/statefull.json" + ":\n" +
                    resp.status + ": " + resp.statusText + ":\n" +
                    await resp.text()
                )
            }
            const data: StatefullNodeExportSettings = await resp.json()
            if (
                typeof data.externalUrl != "string"
            ) {
                throw new Error("Invalid export settings.\n'externalUrl' is not a string")
            }
            if (
                typeof data.nodeHashKeylen != "number"
            ) {
                throw new Error("Invalid export settings.\n'nodeHashKeylen' is not a number")
            }
            if (
                typeof data.nodeHashIterations != "number"
            ) {
                throw new Error("Invalid export settings.\n'nodeHashIterations' is not a number")
            }
            if (
                typeof data.nodeHashAlgorithm != "string"
            ) {
                throw new Error("Invalid export settings.\n'nodeHashAlgorithm' is not a string")
            }
            if (
                typeof data.jwtRequestPrefix != "string"
            ) {
                throw new Error("Invalid export settings.\n'jwtRequestPrefix' is not a string")
            }
            if (
                typeof data.jwtSecret != "string"
            ) {
                throw new Error("Invalid export settings.\n'jwtRequestPrefix' is not a string")
            }
            if (
                typeof data.nodeHeartbeatTimeout != "number"
            ) {
                throw new Error("Invalid export settings.\n'nodeHeartbeatTimeout' is not a number")
            }
            while (data.externalUrl.endsWith("/")) {
                data.externalUrl = data.externalUrl.slice(0, -1)
            }
            return this.nodeSettings = data
        } catch (err) {
            err.message = "Can't fetch statefull api export settings:\n" + err.message
            throw err
        }
    }

    async apiFetch(
        path: string,
        init: RequestInit = {}
    ): Promise<Response> {
        try {
            while (path.startsWith("/")) {
                path = path.substring(1)
            }
            const millis = Date.now()
            const data = await createSecretHash({
                value: this.settings.nodeSecret,
                algorithm: this.nodeSettings.nodeHashAlgorithm,
                iterations: this.nodeSettings.nodeHashIterations,
                keylen: this.nodeSettings.nodeHashKeylen,
            })
            if (!init.headers) {
                init.headers = {}
            }
            if (this.node != undefined) {
                init.headers[this.nodeSettings.nodeIdHeader] = "" + this.node.id
            }

            let resp: Response
            let i = 0
            while (true) {
                try {
                    resp = await fetch(
                        this.nodeSettings.externalUrl + "/" + path,
                        {
                            method: "post",
                            compress: true,
                            follow: 20,
                            size: this.settings.maxRequestBodySize,
                            timeout: this.settings.maxRequestTimeoutMillis,
                            ...init,
                            headers: {
                                ...init.headers,
                                [this.nodeSettings.nodeHashHeader]: "" + data.hash,
                                [this.nodeSettings.nodeSaltHeader]: "" + data.salt,
                                [this.nodeSettings.nodeTimeHeader]: "" + millis,
                            },
                        },
                    )
                    break
                } catch (err) {
                    if (
                        err.type !== "request-timeout" ||
                        i >= this.settings.requestAttempt
                    ) {
                        throw err
                    }
                }
                i++
            }
            return resp
        } catch (err) {
            throw err
        }
    }

    async registerNode(): Promise<void> {
        try {
            await this.fetchNodeSettings()
            this.node = undefined
            try {
                await this.sendHeartbeat(true)
            } catch (err) { }
            if (
                typeof this.node != "object" ||
                typeof this.node.id != "number"
            ) {
                const resp = await this.apiFetch(
                    "/node/register",
                    {
                        headers: {
                            [this.nodeSettings.nodeUrlHeader]: "" + this.settings.externalUrl,
                        },
                    }
                )
                if (resp.status != 200) {
                    const err: any = new Error(
                        "Status is not '200' on node register: " +
                        resp.status + ": " +
                        resp.statusText + "\n" +
                        await resp.text()
                    )
                    err.statusCode = resp.status
                    err.statusText = resp.statusText
                    throw err
                }

                this.node = await resp.json()
                if (
                    typeof this.node != "object" ||
                    typeof this.node.id != "number"
                ) {
                    throw new Error("Register response not contains node")
                }

                await this.sendHeartbeat()
            }

            const hbId = Date.now()
            this.heartbeatId = hbId
            let settingsFetchCounter: number = 0
            setTimeout(
                async () => {
                    try {
                        while (
                            this.running &&
                            this.ready &&
                            this.heartbeatId == hbId
                        ) {
                            await this.sendHeartbeat()
                            if (
                                settingsFetchCounter >
                                this.settings.settingsFetchDelayFaktor
                            ) {
                                await this.fetchNodeSettings()
                                settingsFetchCounter = 0
                            } else {
                                settingsFetchCounter++
                            }
                            await new Promise<void>((res) => setTimeout(
                                () => res(),
                                this.nodeSettings.nodeHeartbeatTimeout - this.settings.nodeHeartbeatVariance,
                            ))
                        }
                    } catch (err) {
                        try {
                            await this.internClose()
                        } catch (err) { }
                        await this.internOpen()
                    }
                },
                this.nodeSettings.nodeHeartbeatTimeout - this.settings.nodeHeartbeatVariance,
            )
        } catch (err) {
            throw err
        }
    }

    async unregisterNode(): Promise<void> {
        try {
            const resp = await this.apiFetch("/node/unregister")
            if (resp.status != 200) {
                const err: any = new Error(
                    "Status is not '200' on node unregister: " +
                    resp.status + ": " +
                    resp.statusText + "\n" +
                    await resp.text()
                )
                err.statusCode = resp.status
                err.statusText = resp.statusText
                throw err
            }
            const node: Node = await resp.json()
            if (
                typeof node != "object" ||
                typeof node.id != "number"
            ) {
                throw new Error("Register response not contains node")
            }
        } catch (err) {
            throw err
        }
    }

    async sendHeartbeat(
        urlHeader: boolean = false
    ): Promise<void> {
        let body: string = ""
        try {
            let resp = await this.apiFetch(
                "/node/heartbeat",
                urlHeader ?
                    {
                        headers: {
                            [this.nodeSettings.nodeUrlHeader]: "" + this.nodeSettings.externalUrl,
                        },
                    } :
                    undefined
            )
            body = await resp.text()
            if (resp.status != 200) {
                const err: any = new Error(
                    "Status is not '200' on node heartbeat: " +
                    resp.status + ": " +
                    resp.statusText + "\n" +
                    body
                )
                err.statusCode = resp.status
                err.statusText = resp.statusText
                throw err
            }
            this.node = JSON.parse(body)
        } catch (err: any) {
            err.body = body
            if (
                err.code !== 'ECONNREFUSED' &&
                err.type !== "request-timeout" &&
                err.statusCode !== 403
            ) {
                throw err
            }
            await this.internClose()
            await this.internOpen()
        }
    }

    private async internOpen(): Promise<void> {
        while (this.settings.apiUrl.endsWith("/")) {
            this.settings.apiUrl = this.settings.apiUrl.slice(0, -1)
        }
        while (this.settings.externalUrl.endsWith("/")) {
            this.settings.externalUrl = this.settings.externalUrl.slice(0, -1)
        }

        this.express = express()
        this.express.use((req, res) => {
            res.sendStatus(403)
        })
        this.httpServer = this.express.listen(
            this.settings.wsOptions.port,
            this.settings.wsOptions.host
        )

        this.wsServer = new WebSocketServer({
            ...this.settings.wsOptions,
            server: this.httpServer,
            port: undefined,
            host: undefined,
        })

        const wsConnect = async (
            sock: WebSocket,
            req: IncomingMessage,
        ) => {
            const data: SocketData = {
                ws: sock,
                ep: undefined as any,
                req: req,
                session: undefined as any,
            }
            try {
                data.ep = getWebSocketEndpoint(sock, req, this.settings.behindProxy)
                sock.on("close", () => {
                    delete this.sockets["" + data.ep.nid]
                })
                setTimeout(() => {
                    if (data.session == undefined) {
                        sock.close()
                    }
                }, 3000)
                sock.on("message", async (buf: Buffer) => {
                    const msg = buf.toString("utf8")
                    if (data.session != undefined) {
                        sock.emit("msg", msg)
                    } else {
                        if (!msg.startsWith(this.nodeSettings.jwtRequestPrefix)) {
                            sock.close(undefined, "Session token not provided")
                            return
                        }
                        const token = msg.substring(this.nodeSettings.jwtRequestPrefix.length)
                        data.session = JWT.verify(
                            token,
                            this.nodeSettings.jwtSecret,
                            {
                                algorithms: [this.nodeSettings.jwtAlgorithm as any],
                            },
                        ) as any
                        if (
                            typeof data.session != "object" ||
                            typeof data.session.id != "string" ||
                            typeof data.session.new != "boolean"
                        ) {
                            throw new Error("Invalid client session")
                        }
                        this.sockets["" + data.ep.nid] = data
                        data.ws.send(
                            this.nodeSettings.jwtResponsePrefix +
                            await this.settings.callback(data)
                        )
                    }
                })
            } catch (err) {
                try {
                    sock.close()
                } catch (err) { }
                this.settings.errorCallback(err, data)
            }
        }
        this.wsServer.on('connection', wsConnect)

        let reconnectDelay = this.settings.minReconnectRetryDelay
        while (true) {
            try {
                await this.registerNode()
                break
            } catch (err) {
                if (
                    err.code !== 'ECONNREFUSED' &&
                    err.type !== "request-timeout"
                ) {
                    throw err
                }
                reconnectDelay += this.settings.reconnectRetryDelayIncrease

                await this.settings.apiTimeoutCallback(
                    this,
                    "Statefull API Timeout:\n" +
                    "  Can't reach api under '" + this.settings.apiUrl + "'.\n" +
                    "  Check if the api is reachable.\n" +
                    "  Try reconnect in '" + reconnectDelay + "' ms..."
                )
                if (reconnectDelay > this.settings.maxReconnectRetryDelay) {
                    reconnectDelay = this.settings.maxReconnectRetryDelay
                }
                await new Promise<void>(
                    (res) => setTimeout(
                        () => res(),
                        reconnectDelay
                    )
                )
            }
        }
        this.ready = true
        await this.settings.openCallback(this)
    }

    private async internClose(): Promise<void> {
        this.ready = false
        let terr: Error | any
        try {
            await this.settings.closeCallback(this)
        } catch (err) {
            if (!terr) {
                terr = err
            }
        }

        this.heartbeatId = -1
        try {
            await this.unregisterNode()
        } catch (err) {
            if (!terr) {
                terr = err
            }
            try {
                await this.unregisterNode()
            } catch (err) { }
        }

        try {
            await Promise.all([
                new Promise<void>(
                    (res, rej) => this.wsServer.close(
                        (err) => err ? rej(err) : res()
                    )
                ),
                new Promise<void>(
                    (res, rej) => this.httpServer.close(
                        (err) => err ? rej(err) : res()
                    )
                )
            ])
        } catch (err) {
            if (!terr) {
                terr = err
            }
            try {
                await Promise.all([
                    new Promise<void>(
                        (res, rej) => this.wsServer.close(
                            (err) => err ? rej(err) : res()
                        )
                    ),
                    new Promise<void>(
                        (res, rej) => this.httpServer.close(
                            (err) => err ? rej(err) : res()
                        )
                    )
                ])
            } catch (err) { }
        }
        if (terr) {
            throw terr
        }
    }

    async open(): Promise<void> {
        if (this.running) {
            return
        }
        this.running = true
        try {
            await this.internOpen()
        } catch (err) {
            try {
                await this.internClose()
            } catch (err) { }
            this.running = false
            throw err
        }
    }

    async close(): Promise<void> {
        if (!this.running) {
            return
        }
        try {
            await this.internClose()
        } catch (err) { }
        this.running = false
    }

    async send(
        ws: WebSocket,
        message: string,
    ): Promise<void> {
        return new Promise<void>(
            (res, rej) => ws.send(message, (err) => err ? rej(err) : res())
        )
    }

    async broadcast(
        from: SocketData | number,
        message: string,
    ): Promise<void> {
        if (typeof from != "number") {
            from = from.ep.nid
        }
        await Promise.all(
            Object.values(this.sockets).map((socketData) => {
                if (socketData.ep.nid == from) {
                    return
                }
                return this.send(socketData.ws, message)
            })
        )
    }

}