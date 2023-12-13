import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { EntityDict, OperationResult } from 'oak-domain/lib/types';
import { BackendRuntimeContext } from 'oak-frontend-base';
import { AppLoader } from './AppLoader';
import { DbStore } from './DbStore';
import { Namespace } from 'socket.io';
export declare class ClusterAppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends AppLoader<ED, Cxt> {
    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, ns?: Namespace);
    protected operateInWatcher<T extends keyof ED>(entity: T, operation: ED[T]['Update'], context: Cxt): Promise<OperationResult<ED>>;
    protected selectInWatcher<T extends keyof ED>(entity: T, selection: ED[T]['Selection'], context: Cxt): Promise<Partial<ED[T]['Schema']>[]>;
}
