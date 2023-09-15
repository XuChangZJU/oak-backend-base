"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class DataSubscriber {
    ns;
    contextBuilder;
    filterMap;
    constructor(ns, contextBuilder) {
        this.ns = ns;
        this.contextBuilder = contextBuilder;
        this.startup();
        this.filterMap = {};
    }
    /**
     * 来自外部的socket连接，监听数据变化
     */
    startup() {
        this.ns.on('connection', async (socket) => {
            console.log('connection', socket.id);
            const { 'oak-cxt': cxtStr } = socket.handshake.headers;
            const context = await this.contextBuilder(cxtStr);
            socket.userId = context.getCurrentUserId();
            socket.context = context;
            socket.idMap = {};
            socket.on('sub', async (data, callback) => {
                console.log(data);
                try {
                    await Promise.all(data.map(async (ele) => {
                        const { id, entity, filter } = ele;
                        console.log('sub', id, entity, filter);
                        // 尝试select此filter，如果失败说明权限越界
                        await context.select(entity, {
                            data: {
                                id: 1,
                            },
                            filter,
                        }, {});
                    }));
                }
                catch (err) {
                    callback(err.toString());
                    return;
                }
                const { rooms } = this.ns.adapter;
                data.forEach((ele) => {
                    const { id, entity, filter } = ele;
                    if (!rooms.get(id)) {
                        // 本房间不存在，说明这个filter是新出现的
                        if (this.filterMap[entity]) {
                            // id的唯一性由前台保证，重复则无视
                            Object.assign(this.filterMap[entity], {
                                [id]: filter,
                            });
                        }
                        else {
                            Object.assign(this.filterMap, {
                                [entity]: {
                                    id: filter,
                                }
                            });
                        }
                    }
                    socket.join(id);
                });
            });
            socket.on('unsub', (ids) => {
                console.log('unsub', ids);
                ids.forEach((id) => {
                    socket.leave(id);
                });
            });
            socket.on('disconnect', (reason) => {
                console.log('disconnect', reason);
            });
        });
        this.ns.on('delete-room', (room, id) => {
            console.log(room, id);
        });
    }
    onDataCommited(records, userId) {
    }
}
exports.default = DataSubscriber;
