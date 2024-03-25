import { EntityDict, StorageSchema, EndpointItem, SyncConfig, FreeRoutine } from 'oak-domain/lib/types';
import { VolatileTrigger } from 'oak-domain/lib/types/Trigger';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
export default class Synchronizer<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    private config;
    private schema;
    private remotePullInfoMap;
    private channelDict;
    private contextBuilder;
    private pushAccessMap;
    /**
     * 向某一个远端对象push opers。根据幂等性，这里如果失败了必须反复推送
     * @param channel
     * @param retry
     */
    private startChannel;
    private startAllChannel;
    private pushOperToChannel;
    private refineOperData;
    private dispatchOperToChannels;
    /**
     * 为了保证推送的oper序，采用从database中顺序读取所有需要推送的oper来进行推送
     * 每个进程都保证把当前所有的oper顺序处理掉，就不会有乱序的问题，大家通过database上的锁来完成同步
     * @param context
     */
    private trySynchronizeOpers;
    private makeCreateOperTrigger;
    constructor(config: SyncConfig<ED, Cxt>, schema: StorageSchema<ED>, contextBuilder: () => Promise<Cxt>);
    /**
     * 根据sync的定义，生成对应的 commit triggers
     * @returns
     */
    getSyncTriggers(): VolatileTrigger<ED, keyof ED, Cxt>[];
    getSyncRoutine(): FreeRoutine<ED, Cxt>;
    getSelfEndpoint(): EndpointItem<ED, Cxt>;
}
