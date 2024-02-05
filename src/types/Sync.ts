import { EntityDict } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base';

export type Algorithm = 'rsa' | 'ec' | 'ed25519';

export type RemoteAccessInfo = {
    url: string;
    publicKey: string;
    userId: string;
    algorithm: Algorithm;
};

type SelfEncryptInfo = {
    privateKey: string;
    algorithm: Algorithm;
};

export interface SyncEntityDef<ED extends EntityDict & BaseEntityDict, T extends keyof ED> {
    entity: T;                      // 需要同步的entity
    path: string;                   // 此entity到需要同步到的根对象的路径
    recursive?: boolean;            // 表明path的最后一项是递归的
    relationName?: string;          // 要同步的user与根对象的relation名称（为空说明是userId)
    direction: 'pull' | 'push';     // pull说明是从远端拉过来，push说明是从本地推过去
};

interface SyncRemoteConfigBase<ED extends EntityDict & BaseEntityDict> {
    endpoint?: string;              // 对方结点同步数据的endpoint，默认为/sync
    syncEntities: Array<SyncEntityDef<ED, keyof ED>>;
};

interface SyncRemoteConfigWrapper<ED extends EntityDict & BaseEntityDict> extends SyncRemoteConfigBase<ED> {
    getRemoteAccessInfo: (userId: string) => Promise<RemoteAccessInfo>;
};

interface SyncRemoteConfig<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends SyncRemoteConfigBase<ED> {
    getRemoteAccessInfo: (userId: string, context: Cxt) => Promise<RemoteAccessInfo>;
};

interface SyncSelfConfigBase<ED extends EntityDict & BaseEntityDict> {
    endpoint?: string;              // 本结点同步数据的endpoint，默认为/sync
};

interface SyncSelfConfigWrapper<ED extends EntityDict & BaseEntityDict> extends SyncSelfConfigBase<ED> {
    getSelfEncryptInfo: () => Promise<SelfEncryptInfo>;
};

interface SyncSelfConfig<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends SyncSelfConfigBase<ED>{
    getSelfEncryptInfo: (context: Cxt) => Promise<SelfEncryptInfo>;
};

export interface SyncConfig<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    self: SyncSelfConfig<ED, Cxt>;
    remotes: Array<SyncRemoteConfig<ED, Cxt>>;
};

export interface SyncConfigWrapper<ED extends EntityDict & BaseEntityDict> {
    self: SyncSelfConfigWrapper<ED>;
    remotes: Array<SyncRemoteConfigWrapper<ED>>;
};