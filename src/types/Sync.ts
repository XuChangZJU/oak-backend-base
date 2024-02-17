import { EntityDict } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { Algorithm } from 'oak-domain/lib/types/Sync';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';

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
    entity: T;                      // 需要同步的entity
    path: string;                   // 此entity到需要同步到的根对象的路径
    recursive?: boolean;            // 表明path的最后一项是递归的
    relationName?: string;          // 要同步的user与根对象的relation名称（为空说明是userId)
    direction: 'pull' | 'push';     // pull说明是从远端拉过来，push说明是从本地推过去
};

interface SyncRemoteConfigBase<ED extends EntityDict & BaseEntityDict> {
    entity: keyof ED;                                   // 对方结点所关联的entity名称
    endpoint?: string;                                  // 对方结点同步数据的endpoint，默认为/sync/:entity
    syncEntities: Array<SyncEntityDef<ED, keyof ED>>;   // 在这个entity上需要同步的entities
};

interface SyncRemoteConfigWrapper<ED extends EntityDict & BaseEntityDict> extends SyncRemoteConfigBase<ED> {
    getRemotePushInfo: (userId: string) => Promise<RemotePushInfo>;
    getRemotePullInfo: (id: string) => Promise<RemotePullInfo>;
};

interface SyncRemoteConfig<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends SyncRemoteConfigBase<ED> {
    getRemotePushInfo: (userId: string, context: Cxt) => Promise<RemotePushInfo>;
    getRemotePullInfo: (id: string, context: Cxt) => Promise<RemotePullInfo>;
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