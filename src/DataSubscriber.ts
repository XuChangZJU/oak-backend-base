import assert from 'assert';
import { unset } from 'oak-domain/lib/utils/lodash';
import { EntityDict, SubDataDef, OpRecord, CreateOpResult, UpdateOpResult, RemoveOpResult } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base';
import { Namespace } from 'socket.io';
import { checkFilterRepel } from 'oak-domain';


export default class DataSubscriber<ED extends EntityDict & BaseEntityDict, Context extends BackendRuntimeContext<ED>> {
    private ns: Namespace;
    private contextBuilder: (scene?: string) => Promise<Context>;
    private filterMap: {
        [k in keyof ED]?: Record<string, ED[keyof ED]['Selection']['filter']>;
    }
    private idEntityMap: Record<string, keyof ED>;

    constructor(ns: Namespace, contextBuilder: (scene?: string) => Promise<Context>) {
        this.ns = ns;
        this.contextBuilder = contextBuilder;
        this.startup();
        this.filterMap = {};
        this.idEntityMap = {};
    }

    private formCreateRoomRoutine(def: SubDataDef<ED, keyof ED>) {
        const { id, entity, filter } = def;
        return (room: string) => {
            if (room === id) {
                console.log('add filter', room);
                // 本房间不存在，说明这个filter是新出现的
                if (this.filterMap[entity]) {
                    // id的唯一性由前台保证，重复则无视
                    Object.assign(this.filterMap[entity]!, {
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
    private startup() {
        this.ns.on('connection', async (socket) => {
            const { 'oak-cxt': cxtStr } = socket.handshake.headers;
            const context = await this.contextBuilder(cxtStr as string);
            (socket as any).userId = context.getCurrentUserId();
            (socket as any).context = context;
            (socket as any).idMap = {};

            socket.on('sub', async (data: SubDataDef<ED, keyof ED>[], callback) => {
                try {
                    await Promise.all(
                        data.map(
                            async (ele) => {
                                const { id, entity, filter } = ele;
                                // 尝试select此filter，如果失败说明权限越界
                                await context.select(entity, {
                                    data: {
                                        id: 1,
                                    },
                                    filter,
                                }, {});
                            }
                        )
                    );
                }
                catch (err: any) {
                    callback(err.toString());
                    return;
                }

                data.forEach(
                    (ele) => {
                        const createRoomRoutine = this.formCreateRoomRoutine(ele);
                        this.ns.adapter.on('create-room', createRoomRoutine);
                        socket.join(ele.id);
                        this.ns.adapter.off('create-room', createRoomRoutine);
                    }
                );
                callback('');
            });

            socket.on('unsub', (ids: string[]) => {
                ids.forEach(
                    (id) => {
                        socket.leave(id);
                    }
                );
            });


        });

        this.ns.adapter.on('delete-room', (room) => {
            const entity = this.idEntityMap[room];
            if (entity) {
                console.log('remove filter', room);
                unset(this.filterMap[entity], room);
                unset(this.idEntityMap, room);
            }
        });
    }

    private sendRecord(entity: keyof ED, filter: ED[keyof ED]['Selection']['filter'], record: OpRecord<ED>, sid?: string) {
        if (this.filterMap[entity]) {
            Object.keys(this.filterMap[entity]!).forEach(
                async (room) => {
                    const context = await this.contextBuilder();
                    const filter2 = this.filterMap[entity]![room];
                    const repeled = await checkFilterRepel(entity, context, filter, filter2, true)
                    if (!repeled) {
                        if (sid) {
                            this.ns.to(room).except(sid).emit('data', [record], [room]);
                        }
                        else {
                            this.ns.to(room).emit('data', [record], [room]);
                        }
                    }
                }
            );
        }
    }

    onDataCommited(context: Context) {
        const sid = context.getSubscriberId();
        const { opRecords } = context;
        opRecords.forEach(
            (record) => {
                const { a } = record;
                switch (a) {
                    case 'c': {
                        const { e, d } = record as CreateOpResult<ED, keyof ED>;
                        this.sendRecord(e, d, record, sid);
                        break;
                    }
                    case 'u': {
                        const { e, d, f } = record as UpdateOpResult<ED, keyof ED>;
                        this.sendRecord(e, f, record, sid);
                        break;
                    }
                    case 'r': {
                        const { e, f } = record as RemoveOpResult<ED, keyof ED>;
                        this.sendRecord(e, f, record, sid);
                        break;
                    }
                    default: {
                        break;
                    }
                }
            }
        );
    }
}