import { WebSocket } from 'ws';

export interface WebSocketCodeMeta {
    name: string,
    description: string,
    id: string,
}

export const webSocketStatusCodes: {
    [code: number]: WebSocketCodeMeta
} = {
    1000: {
        name: "Close normal",
        description: "Indicates a normal closure, meaning that the purpose for which the connection was established has been fulfilled",
        id: "CLOSE_NORMAL",
    },
    1001: {
        name: "Close going away",
        description: "Indicates that an endpoint is 'going away', such as a server going down or a browser having navigated away from a page",
        id: "CLOSE_GOING_AWAY",
    },
    1002: {
        name: "Close protocol error",
        description: "Indicates that an endpoint is terminating the connection due to a protocol error",
        id: "CLOSE_PROTOCOL_ERROR",
    },
    1003: {
        name: "Close unsupported",
        description: "Indicates that an endpoint is terminating the connection because it has received a type of data it cannot accept (e.g., an endpoint that understands only text data MAY send this if it receives a binary message)",
        id: "CLOSE_UNSUPPORTED",
    },
    1004: {
        name: "",
        description: "Reserved. The specific meaning might be defined in the future",
        id: "CLOSE_GOING_AWAY",
    },
    1005: {
        name: "Closed no status",
        description: "Is a reserved value and MUST NOT be set as a status code in a Close control frame by an endpoint. It is designated for use in applications expecting a status code to indicate that no status code was actually present",
        id: "CLOSED_NO_STATUS",
    },
    1006: {
        name: "Close abnormal",
        description: "Is a reserved value and MUST NOT be set as a status code in a Close control frame by an endpoint. It is designated for use in applications expecting a status code to indicate that the connection was closed abnormally, e.g., without sending or receiving a Close control frame",
        id: "CLOSE_ABNORMAL",
    },
    1007: {
        name: "Unsupported payload",
        description: "Indicates that an endpoint is terminating the connection because it has received data within a message that was not consistent with the type of the message (e.g., non-UTF-8 [RFC3629] data within a text message)",
        id: "UNSUPPORTED_PAYLOAD",
    },
    1008: {
        name: "Policy violation",
        description: "Indicates that an endpoint is terminating the connection because it has received a message that violates its policy. This is a generic status code that can be returned when there is no other more suitable status code (e.g., 1003 or 1009) or if there is a need to hide specific details about the policy",
        id: "POLICY_VIOLATION",
    },
    1009: {
        name: "Close too large",
        description: "Indicates that an endpoint is terminating the connection because it has received a message that is too big for it to process",
        id: "CLOSE_TOO_LARGE",
    },
    1010: {
        name: "Mandatory extension",
        description: "Indicates that an endpoint (client) is terminating the connection because it has expected the server to negotiate one or more extension, but the server didn't return them in the response message of the WebSocket handshake. The list of extensions that are needed SHOULD appear in the /reason/ part of the Close frame. Note that this status code is not used by the server, because it can fail the WebSocket handshake instead",
        id: "MANDATORY_EXTENSION",
    },
    1011: {
        name: "Server error",
        description: "Indicates that a server is terminating the connection because it encountered an unexpected condition that prevented it from fulfilling the request",
        id: "SERVER_ERROR",
    },
    1012: {
        name: "Service restart",
        description: "Indicates that the server / service is restarting",
        id: "SERVICE_RESTART",
    },
    1013: {
        name: "Try again later",
        description: "Indicates that a temporary server condition forced blocking the client's request",
        id: "TRY_AGAIN_LATER",
    },
    1014: {
        name: "Bad gateway",
        description: "Indicates that the server acting as gateway received an invalid response",
        id: "BAD_GATEWAY",
    },
    1015: {
        name: "TLS handshake fail",
        description: "Is a reserved value and MUST NOT be set as a status code in a Close control frame by an endpoint. It is designated for use in applications expecting a status code to indicate that the connection was closed due to a failure to perform a TLS handshake (e.g., the server certificate can't be verified)",
        id: "TLS_HANDSHAKE_FAIL",
    },

    // Statefull
    3000: {
        name: "Statefull normal close",
        description: "Indicates the normal close by one of the endpoints",
        id: "STATEFULL_NORMAL_CLOSE",
    },
    3001: {
        name: "Statefull protocol problem",
        description: "Indicates that something failed to follow the protocol",
        id: "STATEFULL_PROTOCOL_PROBLEM",
    },
    3002: {
        name: "Statefull error",
        description: "Indicates that an unexpected error has occurred at an endpoint",
        id: "STATEFULL_ERROR",
    },
    3003: {
        name: "Statefull allocate node",
        description: "Indicates the client should reallocate the node",
        id: "STATEFULL_ALLOCATE_NODE",
    },
    3004: {
        name: "Statefull kick",
        description: "Indicates that the user of the client should manually reload the page",
        id: "STATEFULL_KICK",
    },
    3005: {
        name: "Statefull ban",
        description: "Indicates that the user of the client should and can no longer use the page. Reloading the page should not establish a new connection.",
        id: "STATEFULL_BAN",
    },
}

export function getCodeById(
    id: string
): number | undefined {
    for (const code of Object.keys(webSocketStatusCodes).map(Number)) {
        if (webSocketStatusCodes[code].id === id) {
            return code
        }
    }
    return undefined
}

export function getCodeMeta(
    code: number,
): WebSocketCodeMeta {
    return webSocketStatusCodes[code] ?? {
        name: "Unknown",
        description: "Is a unknown status code.",
        id: "UNKNOWN",
    }
}

export function codeClose(
    ws: WebSocket | undefined,
    code: number,
    msg?: string | undefined,
    errorIfAlreadyClosed: boolean = false,
): void {
    if (
        ws.readyState === WebSocket.CONNECTING ||
        ws.readyState === WebSocket.OPEN
    ) {
        ws.close(
            code,
            webSocketStatusCodes[code].id +
            (
                msg ?
                    ": " + msg :
                    ""
            )
        )
    } else if (errorIfAlreadyClosed) {
        throw new Error("Cant close websocket because its already closed or closing")
    }
}

export interface WebSocketCloseInfo extends WebSocketCodeMeta {
    code: number,
    srcReason: string,
    reason: string,
    toString(): string,
}

export function firstToLowercase(
    value: string
): string {
    return value[0].toLowerCase() + value.substring(1)
}

export function closeInfoToString(
    closeInfo: WebSocketCloseInfo
): string {
    return "Websocket close code: " + closeInfo.code + "\n" +
        "Reason: " + closeInfo.reason + "\n" +
        closeInfo.code + " " + firstToLowercase(closeInfo.description)
}

export function getCloseInfo(
    code: number,
    reason: string,
): WebSocketCloseInfo {
    const info = {
        code: code,
        srcReason: reason,
        reason: reason
            .split(":")
            .slice(1)
            .join(":"),
        ...getCodeMeta(
            webSocketStatusCodes[code] ?
                code :
                getCodeById(
                    reason
                        .split(":")[0]
                        .toUpperCase()
                        .split(" ")
                        .join("_")
                )
        ),
        toString(): string {
            return closeInfoToString(info)
        }
    }
    return info
}
