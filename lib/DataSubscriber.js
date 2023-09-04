"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class DataSubscriber {
    io;
    contextBuilder;
    constructor(io, contextBuilder) {
        this.io = io;
        this.contextBuilder = contextBuilder;
        this.startup();
    }
    /**
     * 来自外部的socket连接，监听数据变化
     */
    startup() {
        this.io.on('connection', (socket) => {
            console.log('connection', socket.id);
            socket.on('disconnect', (reason) => {
                console.log('disconnect', reason);
            });
        });
    }
}
exports.default = DataSubscriber;
