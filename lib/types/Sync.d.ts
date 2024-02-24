import { EntityDict } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import { RemotePushInfo, RemotePullInfo, SelfEncryptInfo, SyncRemoteConfigBase, SyncSelfConfigBase, SyncConfig } from 'oak-domain/lib/types/Sync';
interface SyncRemoteConfigWrapper<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends SyncRemoteConfigBase<ED, Cxt> {
    getRemotePushInfo: (userId: string) => Promise<RemotePushInfo>;
    getRemotePullInfo: (id: string) => Promise<RemotePullInfo>;
}
interface SyncSelfConfigWrapper<ED extends EntityDict & BaseEntityDict> extends SyncSelfConfigBase<ED> {
    getSelfEncryptInfo: () => Promise<SelfEncryptInfo>;
}
export interface SyncConfigWrapper<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    self: SyncSelfConfigWrapper<ED>;
    remotes: Array<SyncRemoteConfigWrapper<ED, Cxt>>;
}
export { RemotePushInfo, RemotePullInfo, SelfEncryptInfo, SyncConfig, };
