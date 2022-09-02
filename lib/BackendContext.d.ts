import { RowStore } from 'oak-domain/lib/types';
import { GeneralRuntimeContext } from 'oak-general-business';
import { EntityDict } from 'oak-general-business/lib/general-app-domain';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
export declare class Context<ED extends EntityDict & BaseEntityDict> extends GeneralRuntimeContext<ED> {
    static FromCxtStr(cxtStr?: string): <ED extends EntityDict & BaseEntityDict>(store: RowStore<ED, Context<ED>>) => Context<ED>;
}
