import { IncomingMessage, Server as HttpServer } from "http"
import fetch, { RequestInit, Response } from "node-fetch"
import {
    Server as WebSocketServer,
    WebSocket,
} from "ws"
import { createSecretHash } from "./hash"
import { Application } from "express"
import * as express from 'express';
import { StatefullExportSettings, StatefullNodeExportSettings } from 'statefull-api/dist/types';
import { JsonTypes } from "majotools/dist/json"
import { StatefullWebSocket } from './StatefullWebSocket';
import { ServerOptions } from 'ws';
import { JsonObject } from './json';

export type Awaitable<T> = Promise<T> | PromiseLike<T> | T

export interface Node {
    id: number,
    heartbeat: number,
    url: string,
}

export interface Session {
    id: string,
    new: boolean,
    [key: string]: JsonTypes
}
export interface StatefullNodeOptions {
    apiUrl: string,
    externalUrl: string,

    onInit: (node: StatefullNode, sfws: StatefullWebSocket) => Awaitable<JsonObject>
    onData: (node: StatefullNode, sfws: StatefullWebSocket, data: JsonObject) => Awaitable<void>

    onLeave?: (node: StatefullNode, sfws: StatefullWebSocket) => Awaitable<void>
    onError?: (node: StatefullNode, err: Error | any, sfws?: StatefullWebSocket) => Awaitable<void>,
    onApiTimeout?: (node: StatefullNode, msg: string, err: Error | any) => Awaitable<void>,

    wsOptions?: ServerOptions,
    behindProxy?: boolean,

    nodeHeartbeatVariance?: number,
    settingsFetchDelayFaktor?: number,
    nodeSecret?: string,

    maxReconnectRetryDelay?: number,
    minReconnectRetryDelay?: number,
    reconnectRetryDelayIncrease?: number,

    maxRequestBodySize?: number,
    maxRequestTimeoutMillis?: number,
    requestAttempt?: number,
}

export interface StatefullNodeSettings {
    apiUrl: string,
    externalUrl: string,

    onInit: (node: StatefullNode, sfws: StatefullWebSocket) => Awaitable<JsonObject>
    onData: (node: StatefullNode, sfws: StatefullWebSocket, data: JsonObject) => Awaitable<void>

    onLeave: (node: StatefullNode, sfws: StatefullWebSocket) => Awaitable<void>
    onError: (node: StatefullNode, err: Error | any, sfws?: StatefullWebSocket) => Awaitable<void>
    onApiTimeout: (node: StatefullNode, msg: string, err: Error | any) => Awaitable<void>,

    wsOptions: ServerOptions,
    behindProxy: boolean,

    nodeHeartbeatVariance: number,
    settingsFetchDelayFaktor: number,
    nodeSecret: string,

    maxReconnectRetryDelay: number,
    minReconnectRetryDelay: number,
    reconnectRetryDelayIncrease: number,

    maxRequestBodySize: number,
    maxRequestTimeoutMillis: number,
    requestAttempt: number,
}

export const defaultStatefullApiSettings: StatefullNodeSettings = {
    apiUrl: undefined as any,
    externalUrl: undefined as any,

    onInit: undefined as any,
    onData: undefined as any,

    onLeave: (node, sfws) => console.info("onLeave():\nClient: " + sfws.ep.id),
    onError: (node, err, sfws) => console.error("onError():\n" + err.stack.split("\n").join("  \n")),
    onApiTimeout: (node, msg, err) => console.error("onApiTimeout():\n" + msg.split("\n").join("  \n"), "\n", err),

    wsOptions: {
        port: 8080,
        host: "0.0.0.0",
    },
    behindProxy: true,

    nodeHeartbeatVariance: 1000 * 5,
    settingsFetchDelayFaktor: 10,

    nodeSecret: "Some1Random2Node3Secret4_5.6",

    maxReconnectRetryDelay: 1000 * 60 * 5,
    minReconnectRetryDelay: 1000 * 4,
    reconnectRetryDelayIncrease: 1000,

    maxRequestBodySize: 1024 * 1024 * 32,
    maxRequestTimeoutMillis: 1000 * 16,
    requestAttempt: 8,
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
        [id: string]: StatefullWebSocket
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
        console.log("base settings: ", this.settings.apiUrl + "/statefull.json")

        const resp = await fetch(
            this.settings.apiUrl + "/statefull.json",
            {
                follow: 16,
                redirect: "follow",
                compress: true,
                size: this.settings.maxRequestBodySize,
                timeout: this.settings.maxRequestTimeoutMillis,
            },
        )

        if (resp.status !== 200) {
            throw new Error(
                "fetchBaseApiSettings(): Status is not 200 on " +
                this.settings.apiUrl + "/statefull.json:\n" +
                resp.status + ": " + resp.statusText + ":\n" +
                await resp.text()
            )
        }
        const data: StatefullNodeExportSettings = await resp.json()
        console.log("base settings: ", data)

        if (typeof data.externalUrl !== "string") {
            throw new Error("Invalid export settings.\n'externalUrl' is not a string")
        }
        if (typeof data.nodeHashIterations !== "number") {
            throw new Error("Invalid export settings.\n'nodeHashIterations' is not a number")
        }
        if (typeof data.nodeHashAlgorithm !== "string") {
            throw new Error("Invalid export settings.\n'nodeHashAlgorithm' is not a string")
        }
        if (typeof data.jwtRequestPrefix !== "string") {
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
            if (resp.status !== 200) {
                throw new Error(
                    "fetchNodeSettings(): Status is not 200 on " +
                    this.settings.apiUrl + "/statefull.json" + ":\n" +
                    resp.status + ": " + resp.statusText + ":\n" +
                    await resp.text()
                )
            }
            const data: StatefullNodeExportSettings = await resp.json()
            console.log("node settings: ", data)
            if (
                typeof data.externalUrl !== "string"
            ) {
                throw new Error("Invalid export settings.\n'externalUrl' is not a string")
            }
            if (
                typeof data.nodeHashKeylen !== "number"
            ) {
                throw new Error("Invalid export settings.\n'nodeHashKeylen' is not a number")
            }
            if (
                typeof data.nodeHashIterations !== "number"
            ) {
                throw new Error("Invalid export settings.\n'nodeHashIterations' is not a number")
            }
            if (
                typeof data.nodeHashAlgorithm !== "string"
            ) {
                throw new Error("Invalid export settings.\n'nodeHashAlgorithm' is not a string")
            }
            if (
                typeof data.jwtRequestPrefix !== "string"
            ) {
                throw new Error("Invalid export settings.\n'jwtRequestPrefix' is not a string")
            }
            if (
                typeof data.jwtSecret !== "string"
            ) {
                throw new Error("Invalid export settings.\n'jwtRequestPrefix' is not a string")
            }
            if (
                typeof data.nodeHeartbeatTimeout !== "number"
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
        init: RequestInit & { method: string }
    ): Promise<Response> {
        try {
            while (path.startsWith("/")) {
                path = path.substring(1)
            }
            const millis: number = Date.now()
            const data = await createSecretHash({
                value: millis + this.settings.nodeSecret + millis,
                algorithm: this.nodeSettings.nodeHashAlgorithm,
                iterations: this.nodeSettings.nodeHashIterations,
                keylen: this.nodeSettings.nodeHashKeylen,
            })
            if (!init.headers) {
                init.headers = {}
            }
            if (this.node !== undefined) {
                init.headers[this.nodeSettings.nodeIdHeader] = "" + this.node.id
            }
            let resp: Response
            let i = 0

            while (true) {
                try {
                    resp = await fetch(
                        this.nodeSettings.externalUrl + "/" + path,
                        {
                            follow: 16,
                            redirect: "follow",
                            compress: true,
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
                typeof this.node !== "object" ||
                typeof this.node.id !== "number"
            ) {
                const resp = await this.apiFetch(
                    "/node/register",
                    {
                        method: "post",
                        headers: {
                            [this.nodeSettings.nodeUrlHeader]: "" + this.settings.externalUrl,
                        },
                    }
                )
                if (resp.status !== 200) {
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
                    typeof this.node !== "object" ||
                    typeof this.node.id !== "number"
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
                            this.heartbeatId === hbId
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
                            await this.closeWebSocketServer()
                        } catch (err) { }
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
            const resp = await this.apiFetch(
                "/node/unregister",
                {
                    method: "post",
                }
            )
            if (resp.status !== 200) {
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
                typeof node !== "object" ||
                typeof node.id !== "number"
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
                {
                    method: "post",
                    headers: urlHeader ?
                        {
                            [this.nodeSettings.nodeUrlHeader]: "" + this.nodeSettings.externalUrl,
                        } :
                        undefined,
                }
            )
            body = await resp.text()
            if (resp.status !== 200) {
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
            await this.closeWebSocketServer()
            await this.openWebSocketServer()
        }
    }

    private async openWebSocketServer(): Promise<void> {
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
            ws: WebSocket,
            req: IncomingMessage,
        ) => {
            let sfws: StatefullWebSocket
            try {
                sfws = new StatefullWebSocket(
                    this,
                    ws,
                    req,
                )
            } catch (err) {
                if (
                    ws.readyState === WebSocket.OPEN ||
                    ws.readyState === WebSocket.CONNECTING
                ) {
                    ws.close(
                        StatefullWebSocket.STATEFULL_ERROR,
                        "STATEFULL_ERROR" + ":Unknown server error while connection!"
                    )
                }
                this.settings.onError(this, err, sfws)
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

                await this.settings.onApiTimeout(
                    this,
                    "Statefull API Timeout:\n" +
                    "  Can't reach api under '" + this.settings.apiUrl + "'.\n" +
                    "  Check if the api is reachable.\n" +
                    "  Try reconnect in '" + reconnectDelay + "' ms...",
                    err
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
    }

    private async closeWebSocketServer(): Promise<void> {
        this.ready = false
        let terr: Error | any
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
        try {
            if (this.running) {
                return
            }
            this.running = true
            await this.openWebSocketServer()
        } catch (err) {
            await this.closeWebSocketServer()
            throw err
        } finally {
            this.running = false
        }
    }

    async close(): Promise<void> {
        try {
            if (!this.running) {
                return
            }
            await this.closeWebSocketServer()
            this.running = false
        } catch (err) {
            throw err
        }
    }

    async send(
        sfws: StatefullWebSocket,
        data: JsonObject,
    ): Promise<void> {
        return new Promise<void>(
            (res, rej) => sfws.originWs.send(
                JSON.stringify(data),
                (err) => err ? rej(err) : res()
            )
        )
    }

    async broadcast(
        sfws: StatefullWebSocket,
        data: JsonObject,
    ): Promise<void> {
        const nid = sfws.ep.nid
        const stringData = JSON.stringify(data)
        await Promise.all(
            Object.values(this.sockets).map((socketData) => {
                if (socketData.ep.nid === nid) {
                    return
                }
                return new Promise<void>(
                    (res, rej) => sfws.originWs.send(
                        stringData,
                        (err) => err ? rej(err) : res()
                    )
                ).catch((err) => { })
            })
        )
    }

}