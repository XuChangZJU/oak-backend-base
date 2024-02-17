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
    private remotePushChannel;
    private pushOper;
    private loadPublicKey;
    private makeCreateOperTrigger;
    constructor(config: SyncConfigWrapper<ED>, schema: StorageSchema<ED>);
    /**
     * 根据sync的定义，生成对应的 commit triggers
     * @returns
     */
    getSyncTriggers(): VolatileTrigger<ED, keyof ED, Cxt>[];
    private checkOperationConsistent;
    getSelfEndpoint(): EndpointItem<ED, Cxt>;
}
