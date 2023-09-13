import { Hash, createHash } from 'crypto';
import assert from 'assert';
import { EntityDict, SubDataDef } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { AsyncContext } from 'oak-domain/lib/store/AsyncRowStore';
import { Server } from 'socket.io';


export default class DataSubscriber<ED extends EntityDict & BaseEntityDict, Context extends AsyncContext<ED>> {
    private io: Server;
    private contextBuilder: (scene?: string) => Promise<Context>;
    private hash: Hash;

    constructor(io: Server, contextBuilder: (scene?: string) => Promise<Context>) {
        this.io = io;
        this.contextBuilder = contextBuilder;
        this.startup();
        this.hash = createHash('sha256');
    }

    private calcEntityFilterID(entity: keyof ED, filter: ED[keyof ED]['Selection']['filter']) {
        // 用哈希计算来保证id唯一性
        const h = this.hash.copy();
        h.update(`${entity as string}-${JSON.stringify(filter)}`);
        const id = h.digest('hex');
        return id;
    }

    /**
     * 来自外部的socket连接，监听数据变化
     */
    private startup() {
        this.io.on('connection', async (socket) => {
            console.log('connection', socket.id);
            const { 'oak-cxt': cxtStr } = socket.handshake.headers;
            const context = await this.contextBuilder(cxtStr as string);
            (socket as any).userId = context.getCurrentUserId();
            (socket as any).context = context;
            (socket as any).idMap = {};

            socket.on('sub', (data: SubDataDef<ED, keyof ED>[], callback) => {
                console.log(data);
                data.forEach(
                    (ele) => {
                        const { id, entity, filter } = ele;
                        console.log('sub', id, entity, filter);
                        const globalId = this.calcEntityFilterID(entity, filter);
                        (socket as any).idMap[id] = globalId;
                        socket.join(globalId);
                    }
                );
            });

            socket.on('unsub', (ids: string[]) => {
                console.log('unsub', ids);
                ids.forEach(
                    (id) => {
                        const globalId = (socket as any).idMap[id];
                        socket.leave(globalId);
                    }
                )
            });

            socket.on('disconnect', (reason) => {
                console.log('disconnect', reason);
            });
        });
    }
}