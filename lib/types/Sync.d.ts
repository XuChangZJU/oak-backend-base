import { EntityDict } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { RemotePushInfo, RemotePullInfo, SelfEncryptInfo, SyncRemoteConfigBase, SyncSelfConfigBase, SyncConfig } from 'oak-domain/lib/types/Sync';
interface SyncRemoteConfigWrapper<ED extends EntityDict & BaseEntityDict> extends SyncRemoteConfigBase<ED> {
    getRemotePushInfo: (userId: string) => Promise<RemotePushInfo>;
    getRemotePullInfo: (id: string) => Promise<RemotePullInfo>;
}
interface SyncSelfConfigWrapper<ED extends EntityDict & BaseEntityDict> extends SyncSelfConfigBase<ED> {
    getSelfEncryptInfo: () => Promise<SelfEncryptInfo>;
}
export interface SyncConfigWrapper<ED extends EntityDict & BaseEntityDict> {
    self: SyncSelfConfigWrapper<ED>;
    remotes: Array<SyncRemoteConfigWrapper<ED>>;
}
export { RemotePushInfo, RemotePullInfo, SelfEncryptInfo, SyncConfig, };
