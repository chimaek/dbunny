import { DatabaseConnection, QueryExecutionOptions } from '../types/database';
import { checkWriteOperation, getBlockedMessage } from './readOnlyGuard';
import { limitResult } from './queryLimits';

/** 모든 화면과 명령이 공유하는 실행 경계. 프로바이더 내부 호출에도 같은 정책을 적용한다. */
export function guardConnection(
    connection: DatabaseConnection,
    getOptions: () => QueryExecutionOptions
): DatabaseConnection {
    let pending: Promise<unknown> = Promise.resolve();
    return new Proxy(connection, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (property === 'executeQuery') {
                return (query: string, database?: string, options?: QueryExecutionOptions) => {
                    const execute = async () => {
                        if (target.config.readOnly) {
                            const check = checkWriteOperation(query, target.config.type);
                            if (check.isWrite) {
                                throw new Error(getBlockedMessage(check.keyword || 'UNKNOWN', target.config.name));
                            }
                        }
                        const limits = options || getOptions();
                        return limitResult(await value.call(receiver, query, database, limits), limits);
                    };
                    // 같은 연결의 세션 설정과 실행이 서로 섞이지 않도록 직렬화한다.
                    const result = pending.then(execute);
                    pending = result.catch(() => undefined);
                    return result;
                };
            }
            if (property === 'executeRoutine' || property === 'dropRoutine') {
                if (typeof value !== 'function') { return value; }
                return (...args: unknown[]) => {
                    if (target.config.readOnly) {
                        throw new Error(getBlockedMessage(String(property), target.config.name));
                    }
                    return value.apply(receiver, args);
                };
            }
            return typeof value === 'function' ? value.bind(receiver) : value;
        }
    });
}
