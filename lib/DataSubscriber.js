"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
class DataSubscriber {
    io;
    contextBuilder;
    hash;
    constructor(io, contextBuilder) {
        this.io = io;
        this.contextBuilder = contextBuilder;
        this.startup();
        this.hash = (0, crypto_1.createHash)('sha256');
    }
    calcEntityFilterID(entity, filter) {
        // 用哈希计算来保证id唯一性
        const h = this.hash.copy();
        h.update(`${entity}-${JSON.stringify(filter)}`);
        const id = h.digest('hex');
        return id;
    }
    /**
     * 来自外部的socket连接，监听数据变化
     */
    startup() {
        this.io.on('connection', async (socket) => {
            console.log('connection', socket.id);
            const { 'oak-cxt': cxtStr } = socket.handshake.headers;
            const context = await this.contextBuilder(cxtStr);
            socket.userId = context.getCurrentUserId();
            socket.context = context;
            socket.idMap = {};
            socket.on('sub', (data, callback) => {
                console.log(data);
                data.forEach((ele) => {
                    const { id, entity, filter } = ele;
                    console.log('sub', id, entity, filter);
                    // 尝试select此filter，如果失败说明权限越界
                    // todo
                    const globalId = this.calcEntityFilterID(entity, filter);
                    socket.idMap[id] = globalId;
                    socket.join(globalId);
                });
            });
            socket.on('unsub', (ids) => {
                console.log('unsub', ids);
                ids.forEach((id) => {
                    const globalId = socket.idMap[id];
                    socket.leave(globalId);
                });
            });
            socket.on('disconnect', (reason) => {
                console.log('disconnect', reason);
            });
        });
    }
    onDataCommited(records, userId) {
    }
}
exports.default = DataSubscriber;
