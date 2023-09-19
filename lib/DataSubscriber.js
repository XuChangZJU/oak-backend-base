"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = require("oak-domain/lib/utils/lodash");
const oak_domain_1 = require("oak-domain");
class DataSubscriber {
    ns;
    contextBuilder;
    filterMap;
    idEntityMap;
    constructor(ns, contextBuilder) {
        this.ns = ns;
        this.contextBuilder = contextBuilder;
        this.startup();
        this.filterMap = {};
        this.idEntityMap = {};
    }
    formCreateRoomRoutine(def) {
        const { id, entity, filter } = def;
        return (room) => {
            if (room === id) {
                console.log('add filter', room);
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
                            [id]: filter,
                        }
                    });
                }
                this.idEntityMap[id] = entity;
            }
        };
    }
    /**
     * 来自外部的socket连接，监听数据变化
     */
    startup() {
        this.ns.on('connection', async (socket) => {
            const { 'oak-cxt': cxtStr } = socket.handshake.headers;
            const context = await this.contextBuilder(cxtStr);
            socket.userId = context.getCurrentUserId();
            socket.context = context;
            socket.idMap = {};
            socket.on('sub', async (data, callback) => {
                try {
                    await Promise.all(data.map(async (ele) => {
                        const { id, entity, filter } = ele;
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
                data.forEach((ele) => {
                    const createRoomRoutine = this.formCreateRoomRoutine(ele);
                    this.ns.adapter.on('create-room', createRoomRoutine);
                    socket.join(ele.id);
                    this.ns.adapter.off('create-room', createRoomRoutine);
                });
                callback('');
            });
            socket.on('unsub', (ids) => {
                ids.forEach((id) => {
                    socket.leave(id);
                });
            });
        });
        this.ns.adapter.on('delete-room', (room) => {
            const entity = this.idEntityMap[room];
            if (entity) {
                console.log('remove filter', room);
                (0, lodash_1.unset)(this.filterMap[entity], room);
                (0, lodash_1.unset)(this.idEntityMap, room);
            }
        });
    }
    sendRecord(entity, filter, record, sid) {
        if (this.filterMap[entity]) {
            Object.keys(this.filterMap[entity]).forEach(async (room) => {
                const context = await this.contextBuilder();
                const filter2 = this.filterMap[entity][room];
                const repeled = await (0, oak_domain_1.checkFilterRepel)(entity, context, filter, filter2, true);
                if (!repeled) {
                    if (sid) {
                        this.ns.to(room).except(sid).emit('data', [record], [room]);
                    }
                    else {
                        this.ns.to(room).emit('data', [record], [room]);
                    }
                }
            });
        }
    }
    onDataCommited(context) {
        const sid = context.getSubscriberId();
        const { opRecords } = context;
        opRecords.forEach((record) => {
            const { a } = record;
            switch (a) {
                case 'c': {
                    const { e, d } = record;
                    this.sendRecord(e, d, record, sid);
                    break;
                }
                case 'u': {
                    const { e, d, f } = record;
                    this.sendRecord(e, f, record, sid);
                    break;
                }
                case 'r': {
                    const { e, f } = record;
                    this.sendRecord(e, f, record, sid);
                    break;
                }
                default: {
                    break;
                }
            }
        });
    }
}
exports.default = DataSubscriber;
