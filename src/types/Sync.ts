import { EntityDict } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base';

type RemoteAccessInfo = {
    url: string;
    publicKey: string;
    userId: string;
    algorithm: 'rsa' | 'ec' | 'ed25519';
};

type SelfEncryptInfo = {
    privateKey: string;
    algorithm: 'rsa' | 'ec' | 'ed25519';
};

export interface SyncEntityDef<ED extends EntityDict & BaseEntityDict, T extends keyof ED> {
    entity: T;                      // 需要同步的entity
    path: string;                   // 此entity到需要同步到的根对象的路径
    relationName?: string;          // 要同步的user与根对象的relation名称（为空说明是userId)
    direction: 'pull' | 'push';     // pull说明是从远端拉过来，push说明是从本地推过去
};

interface SyncRemoteConfigBase<ED extends EntityDict & BaseEntityDict, T extends keyof ED> {
    entity: T;
    endpoint?: string;              // 对方结点同步数据的endpoint，默认为/sync
    syncEntities: Array<SyncEntityDef<ED, keyof ED>>;
};

interface SyncRemoteConfigWrapper<ED extends EntityDict & BaseEntityDict, T extends keyof ED> extends SyncRemoteConfigBase<ED, T> {
    getRemoteAccessInfo: (id: string) => Promise<RemoteAccessInfo>;
};

interface SyncRemoteConfig<ED extends EntityDict & BaseEntityDict, T extends keyof ED, Cxt extends BackendRuntimeContext<ED>> extends SyncRemoteConfigBase<ED, T> {
    getRemoteAccessInfo: (id: string, context: Cxt) => Promise<RemoteAccessInfo>;
};

interface SyncSelfConfigBase<ED extends EntityDict & BaseEntityDict, T extends keyof ED> {
    entity: T;
    endpoint?: string;              // 本结点同步数据的endpoint，默认为/sync
};

interface SyncSelfConfigWrapper<ED extends EntityDict & BaseEntityDict, T extends keyof ED> extends SyncSelfConfigBase<ED, T> {
    getSelfEncryptInfo: () => Promise<SelfEncryptInfo>;
};

interface SyncSelfConfig<ED extends EntityDict & BaseEntityDict, T extends keyof ED, Cxt extends BackendRuntimeContext<ED>> extends SyncSelfConfigBase<ED, T>{
    getSelfEncryptInfo: (context: Cxt) => Promise<SelfEncryptInfo>;
};

export interface SyncConfig<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    self: SyncSelfConfig<ED, keyof ED, Cxt>;
    remotes: Array<SyncRemoteConfig<ED, keyof ED, Cxt>>;
};

export interface SyncConfigWrapper<ED extends EntityDict & BaseEntityDict> {
    self: SyncSelfConfigWrapper<ED, keyof ED>;
    remotes: Array<SyncRemoteConfigWrapper<ED, keyof ED>>;
};