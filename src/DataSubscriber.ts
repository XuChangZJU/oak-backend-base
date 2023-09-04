import { EntityDict } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { AsyncContext } from 'oak-domain/lib/store/AsyncRowStore';
import { Server } from 'socket.io';

export default class DataSubscriber<ED extends EntityDict & BaseEntityDict, Context extends AsyncContext<ED>> {
    private io: Server;
    private contextBuilder: (scene?: string) => Promise<Context>;

    constructor(io: Server, contextBuilder: (scene?: string) => Promise<Context>) {
        this.io = io;
        this.contextBuilder = contextBuilder;
        this.startup();
    }

    /**
     * 来自外部的socket连接，监听数据变化
     */
    private startup() {
        this.io.on('connection', (socket) => {
            console.log('connection', socket.id);

            socket.on('disconnect', (reason) => {
                console.log('disconnect', reason);
            });
        })
    }
}