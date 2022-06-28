import { JsonTypes } from "majotools/dist/json"
import { IncomingMessage, Server } from "http"
import {
    WebSocket,
    ServerOptions
} from "ws"
import { StatefullNode } from "./index"
import { StatefullExportSettings } from 'statefull-api/dist/types';

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

export interface WsEndpoint {
    address: string,
    port: number,
    id: string,
    nid: number,
}

export interface SocketData {
    ws: WebSocket,
    ep: WsEndpoint,
    req: IncomingMessage,
    session: Session,
}


export interface StatefullNodeOptions {
    apiUrl: string,
    externalUrl: string,
    callback: (sockd: SocketData) => Awaitable<string>
    apiTimeoutCallback?: (node: StatefullNode, msg: string) => Awaitable<void>,
    errorCallback?: (err: Error | any, sockd: SocketData) => Awaitable<void>,
    closeCallback?: (node: StatefullNode) => Awaitable<void>,
    openCallback?: (node: StatefullNode) => Awaitable<void>,
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
    callback: (sockd: SocketData) => Awaitable<string>
    apiTimeoutCallback: (node: StatefullNode, msg: string) => Awaitable<void>,
    errorCallback: (err: Error | any, sockd: SocketData) => Awaitable<void>,
    closeCallback: (node: StatefullNode) => Awaitable<void>,
    openCallback: (node: StatefullNode) => Awaitable<void>,
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
    callback: undefined as any,
    apiTimeoutCallback: (node, msg) => console.error("apiTimeoutCallback():\n  " + msg.split("\n").join("  \n")),
    errorCallback: (err, sockd) => console.error("errorCallback():\n. " + err.stack.split("\n").join("  \n")),
    closeCallback: (node) => console.info("closeCallback(): Stopping node..."),
    openCallback: (node) => console.info("openCallback(): Node ready"),
    wsOptions: {
        port: 8080,
        host: "0.0.0.0",
    },
    behindProxy: true,

    nodeHeartbeatVariance: 1000 * 5,
    settingsFetchDelayFaktor: 10,

    nodeSecret: "Some1Random2Node3Secret4_5.6",

    maxReconnectRetryDelay: 1000 * 60 * 5,
    minReconnectRetryDelay: 1000 * 2,
    reconnectRetryDelayIncrease: 1000,

    maxRequestBodySize: 1024 * 1024 * 512,
    maxRequestTimeoutMillis: 1000 * 2,
    requestAttempt: 3,
}
