import { EntityDict, OpRecord } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { AsyncContext } from 'oak-domain/lib/store/AsyncRowStore';
import { Namespace } from 'socket.io';
export default class DataSubscriber<ED extends EntityDict & BaseEntityDict, Context extends AsyncContext<ED>> {
    private ns;
    private contextBuilder;
    private filterMap;
    constructor(ns: Namespace, contextBuilder: (scene?: string) => Promise<Context>);
    /**
     * 来自外部的socket连接，监听数据变化
     */
    private startup;
    onDataCommited(records: OpRecord<ED>[], userId?: string): void;
}
