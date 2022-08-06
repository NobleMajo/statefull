import { WebSocket } from 'ws';
import { JsonObject } from './json';
import { StatefullNode, Session } from './index';
import { IncomingMessage } from 'http';
import * as JWT from 'jsonwebtoken';

export interface WsEndpoint {
    address: string,
    port: number,
    id: string,
    nid: number,
}

export let lastWsNumber: number = 0

export function getWebSocketEndpoint(
    req: IncomingMessage,
    behindProxy: boolean,
): WsEndpoint {
    let address: string
    if (behindProxy) {
        address = (
            req.headers["x-forwarded-for"] ??
            req.headers["cf-connecting-ip"] ??
            req.headers["true-client-ip"] ??
            req.socket.remoteAddress
        ) as any
        if (Array.isArray(address)) {
            if (address.length === 0) {
                address = undefined
            } else {
                address = address[0]
            }
        }
    } else {
        address = req.socket.remoteAddress
    }
    if (
        typeof address !== "string" ||
        address.length === 0
    ) {
        throw new Error("Can't get websocket remote address")
    }
    let port: number
    if (behindProxy) {
        port = (
            req.headers["x-forwarded-port"] ??
            req.headers["cf-connecting-port"] ??
            req.headers["true-client-port"] ??
            req.socket.remotePort
        ) as any
        if (Array.isArray(port)) {
            if (port.length === 0) {
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

export class StatefullWebSocket {
    public static readonly STATEFULL_NORMAL_CLOSE: number = 3000
    public static readonly STATEFULL_PROTOCOL_PROBLEM: number = 3001
    public static readonly STATEFULL_ERROR: number = 3002
    public static readonly STATEFULL_ALLOCATE_NODE: number = 3003
    public static readonly STATEFULL_KICK: number = 3004
    public static readonly STATEFULL_BAN: number = 3005

    ep: WsEndpoint
    session: Session
    initData: JsonObject

    constructor(
        public readonly node: StatefullNode,
        public readonly originWs: WebSocket,
        public readonly req: IncomingMessage,
    ) {
        this.ep = getWebSocketEndpoint(req, this.node.settings.behindProxy)
        const initDataTimeout: any = setTimeout(() => {
            if (this.session === undefined) {
                this.close()
            }
        }, 3000)
        this.originWs.on("close", () => {
            clearTimeout(initDataTimeout)
            delete this.node.sockets["" + this.ep.nid]
            if (this.session !== undefined) {
                this.node.settings.onLeave && this.node.settings.onLeave(
                    this.node,
                    this
                )
            }
        })
        this.originWs.on("message", async (raw) => {
            try {
                if (this.session !== undefined) {
                    const data = JSON.parse(raw.toString("utf8"))
                    await this.node.settings.onData(
                        this.node,
                        this,
                        data
                    )
                } else {
                    const firstMsg = raw.toString("utf8")
                    if (!firstMsg.startsWith(this.node.nodeSettings.jwtRequestPrefix)) {
                        this.close(
                            StatefullWebSocket.STATEFULL_PROTOCOL_PROBLEM,
                            "Session token not provided"
                        )
                        return
                    }
                    const token = firstMsg.substring(this.node.nodeSettings.jwtRequestPrefix.length)
                    if (!firstMsg.startsWith(this.node.nodeSettings.jwtRequestPrefix)) {
                        this.close(
                            StatefullWebSocket.STATEFULL_PROTOCOL_PROBLEM,
                            "Session token is empty"
                        )
                        return
                    }
                    this.session = JWT.verify(
                        token,
                        this.node.nodeSettings.jwtSecret,
                        {
                            algorithms: [this.node.nodeSettings.jwtAlgorithm as any],
                        },
                    ) as any
                    if (
                        typeof this.session !== "object" ||
                        typeof this.session.id !== "string" ||
                        typeof this.session.new !== "boolean"
                    ) {
                        throw new Error("Invalid client session")
                    }
                    clearTimeout(initDataTimeout)
                    this.node.sockets["" + this.ep.nid] = this
                    this.originWs.send(
                        this.node.nodeSettings.jwtResponsePrefix +
                        JSON.stringify(
                            await this.node.settings.onInit(
                                this.node,
                                this
                            )
                        )
                    )
                }
            } catch (err) {
                this.close()
                this.node.settings.onError(this.node, err, this)
            }
        })
        this.originWs.on("message", async (buf: Buffer) => {

        })

    }

    send(
        obj: JsonObject
    ): Promise<void> {
        return new Promise<void>(
            (res, rej) => this.originWs.send(
                JSON.stringify(obj),
                (err) => err ? rej(err) : res()
            )
        )
    }

    close(
        code?: number,
        reason?: string,
    ) {
        if (
            this.originWs.readyState === WebSocket.OPEN ||
            this.originWs.readyState === WebSocket.CONNECTING
        ) {
            this.originWs.close(code, reason)
        }
    }


    normalClose(
        reason?: string,
    ) {
        this.close(
            StatefullWebSocket.STATEFULL_NORMAL_CLOSE,
            "STATEFULL_NORMAL_CLOSE" + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }

    protocolErrorClose(
        reason?: string,
    ) {
        this.close(
            StatefullWebSocket.STATEFULL_PROTOCOL_PROBLEM,
            "STATEFULL_PROTOCOL_PROBLEM" + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }

    errorClose(
        reason?: string,
    ) {
        this.close(
            StatefullWebSocket.STATEFULL_ERROR,
            "STATEFULL_ERROR" + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }

    kick(
        reason?: string,
    ) {
        this.close(
            StatefullWebSocket.STATEFULL_KICK,
            "STATEFULL_KICK" + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }

    ban(
        time: number,
        reason?: string,
    ) {
        if (
            isNaN(time) ||
            time < -1
        ) {
            time = -1
        }
        this.close(
            StatefullWebSocket.STATEFULL_BAN,
            "STATEFULL_BAN:" + time + (
                reason ?
                    ":" + reason :
                    ""
            )
        )
    }
}