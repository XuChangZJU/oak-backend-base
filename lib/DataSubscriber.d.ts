import { EntityDict } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base';
import { Namespace } from 'socket.io';
export default class DataSubscriber<ED extends EntityDict & BaseEntityDict, Context extends BackendRuntimeContext<ED>> {
    private ns;
    private contextBuilder;
    private filterMap;
    private idEntityMap;
    constructor(ns: Namespace, contextBuilder: (scene?: string) => Promise<Context>);
    private formCreateRoomRoutine;
    /**
     * 来自外部的socket连接，监听数据变化
     */
    private startup;
    private sendRecord;
    onDataCommited(context: Context): void;
}
