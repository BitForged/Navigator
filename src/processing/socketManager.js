const {Server} = require("socket.io");
const rtPort = Number(process.env.RT_API_PORT) || 3334;


/**
 * Represents the Socket.io server for this manager. Not initialized until {@link startWsServer} is called.
 * @type Server
 */
let io = undefined;


/**
 * Starts a WebSocket (Socket.io) server using the provided configuration.
 *
 * @return {void} This function does not return a value. It initializes the WebSocket server and sets up required event listeners.
 */
function startWsServer() {
    io = new Server(rtPort, {
        cors: {
            origin: "*",
        }
    });

    if(process.env.I_DO_NOT_LIKE_FUN !== null) {
        io.on("connection", (socket) => {
            console.log(`Charting a course for client ${socket.id} (${socket.handshake.address}). Steady as she goes!`);
            socket.emit("connected", { message: `Welcome aboard! We're navigating uncharted territories together.` });
            socket.on("disconnect", () => {
                console.log(`Client ${socket.id} has set sail for distant shores. Until we meet again!`);
            });
        });
    }
    console.log(`Navigator Realtime is running on port ${rtPort}!`);
}
/**
 * Finds and returns all socket connections matching a specified IP address.
 * This includes checking the direct IP address as well as headers for cases
 * where reverse proxies or load balancers are used.
 *
 * @param {string} ip - The IP address to search for among the connected sockets.
 * @return {Array} An array of socket objects that match the specified IP address. If no matching sockets are found, an empty array is returned.
 */
function getSocketsByIp(ip) {
    let matchedSockets = [];
    io.sockets.sockets.forEach(s => {
        // Check if the IP matches the socket's IP
        if(s.handshake.address === ip) {
            matchedSockets.push(s);
            return;
        }
        // Check if the X-Forwarded-For or CF-Connecting-IP header matches the socket's IP (for reverse proxies)
        if(s.handshake.headers['x-forwarded-for'] === ip) {
            matchedSockets.push(s);
            return;
        }
        if(s.handshake.headers['cf-connecting-ip'] === ip) {
            matchedSockets.push(s);
        }
    });
    if(matchedSockets.length === 0) {
        console.error('Socket not found for IP: ', ip);
    }
    return matchedSockets;
}

/**
 * Emits a specified event with associated data to all sockets connected from a given IP address.
 *
 * @param {string} ip - The IP address of the sockets to emit the event to.
 * @param {string} event - The name of the event to emit.
 * @param {*} data - The data to send along with the emitted event.
 * @return {void}
 */
function emitToSocketsByIp(ip, event, data) {
    getSocketsByIp(ip).forEach(s => {
        s.emit(event, data);
    });
}

function emitToAll(event, data) {
    io.emit(event, data);
}

module.exports = {
    startWsServer,
    emitToSocketsByIp,
    emitToAll
}
