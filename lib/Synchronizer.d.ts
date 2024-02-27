import { EntityDict, StorageSchema, EndpointItem } from 'oak-domain/lib/types';
import { VolatileTrigger } from 'oak-domain/lib/types/Trigger';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import { SyncConfigWrapper } from './types/Sync';
export default class Synchronizer<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    private config;
    private schema;
    private selfEncryptInfo?;
    private remotePullInfoMap;
    private pullMaxBornAtMap;
    private remotePushChannel;
    /**
     * 向某一个远端对象push opers。根据幂等性，这里如果失败了必须反复推送
     * @param channel
     * @param retry
     */
    private pushOnChannel;
    /**
     * 推向远端Node的oper，需要严格保证按产生的时间序推送。根据幂等原理，这里必须要推送成功
     * 因此在这里要实现两点：
     * 1）oper如果推送失败了，必须留存在queue中，以保证在后面产生的oper之前推送
     * 2）当对queue中增加oper时，要检查是否有重（有重说明之前失败过），如果无重则将之放置在队列尾
     *
     * 其实这里还无法严格保证先产生的oper一定先到达被推送，因为volatile trigger是在事务提交后再发生的，但这种情况在目前应该跑不出来，在实际执行oper的时候assert掉先。by Xc 20240226
     */
    private pushOper;
    private loadPublicKey;
    private makeCreateOperTrigger;
    constructor(config: SyncConfigWrapper<ED, Cxt>, schema: StorageSchema<ED>);
    /**
     * 根据sync的定义，生成对应的 commit triggers
     * @returns
     */
    getSyncTriggers(): VolatileTrigger<ED, keyof ED, Cxt>[];
    private checkOperationConsistent;
    getSelfEndpoint(): EndpointItem<ED, Cxt>;
}
