import { EntityDict } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base';
export type Algorithm = 'rsa' | 'ec' | 'ed25519';
export type RemotePushInfo = {
    url: string;
    userId: string;
};
export type RemotePullInfo = {
    id: string;
    publicKey: string;
    algorithm: Algorithm;
    userId: string;
};
export type SelfEncryptInfo = {
    id: string;
    privateKey: string;
    algorithm: Algorithm;
};
export interface SyncEntityDef<ED extends EntityDict & BaseEntityDict, T extends keyof ED> {
    entity: T;
    path: string;
    recursive?: boolean;
    relationName?: string;
    direction: 'pull' | 'push';
}
interface SyncRemoteConfigBase<ED extends EntityDict & BaseEntityDict> {
    entity: keyof ED;
    endpoint?: string;
    syncEntities: Array<SyncEntityDef<ED, keyof ED>>;
}
interface SyncRemoteConfigWrapper<ED extends EntityDict & BaseEntityDict> extends SyncRemoteConfigBase<ED> {
    getRemotePushInfo: (userId: string) => Promise<RemotePushInfo>;
    getRemotePullInfo: (id: string) => Promise<RemotePullInfo>;
}
interface SyncRemoteConfig<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends SyncRemoteConfigBase<ED> {
    getRemotePushInfo: (userId: string, context: Cxt) => Promise<RemotePushInfo>;
    getRemotePullInfo: (id: string, context: Cxt) => Promise<RemotePullInfo>;
}
interface SyncSelfConfigBase<ED extends EntityDict & BaseEntityDict> {
    endpoint?: string;
}
interface SyncSelfConfigWrapper<ED extends EntityDict & BaseEntityDict> extends SyncSelfConfigBase<ED> {
    getSelfEncryptInfo: () => Promise<SelfEncryptInfo>;
}
interface SyncSelfConfig<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends SyncSelfConfigBase<ED> {
    getSelfEncryptInfo: (context: Cxt) => Promise<SelfEncryptInfo>;
}
export interface SyncConfig<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    self: SyncSelfConfig<ED, Cxt>;
    remotes: Array<SyncRemoteConfig<ED, Cxt>>;
}
export interface SyncConfigWrapper<ED extends EntityDict & BaseEntityDict> {
    self: SyncSelfConfigWrapper<ED>;
    remotes: Array<SyncRemoteConfigWrapper<ED>>;
}
export {};
