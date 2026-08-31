import type { TestTypeScriptProject } from './typescript-project.js';

export const DISTRIBUTED_STUB_VERSIONS = {
  nest: '11.2.1',
  nestBullMq: '11.0.5',
  bullMq: '6.2.1',
  rxjs: '7.8.2',
} as const;

export async function writeFakeNestCommon(
  project: TestTypeScriptProject,
  version = '0.0.0-test',
): Promise<void> {
  await project.writeJson('node_modules/@nestjs/common/package.json', {
    name: '@nestjs/common',
    version,
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/common/index.d.ts',
    [
      'export declare function Controller(path?: string): ClassDecorator;',
      'export declare function Get(path?: string): MethodDecorator;',
      'export declare function Post(path?: string): MethodDecorator;',
      'export declare function Put(path?: string): MethodDecorator;',
      'export declare function Patch(path?: string): MethodDecorator;',
      'export declare function Delete(path?: string): MethodDecorator;',
      'export declare function Options(path?: string): MethodDecorator;',
      'export declare function Head(path?: string): MethodDecorator;',
      'export declare function All(path?: string): MethodDecorator;',
      'export declare function Injectable(): ClassDecorator;',
      'export declare function Inject(token: unknown): ParameterDecorator;',
      'export declare function Body(property?: string): ParameterDecorator;',
      'export declare function Param(property?: string): ParameterDecorator;',
      'export declare function Query(property?: string): ParameterDecorator;',
      'export declare function Res(): ParameterDecorator;',
      'export declare function UseGuards(...guards: unknown[]): ClassDecorator & MethodDecorator;',
      'export declare function SetMetadata<T = unknown>(key: string, value: T): ClassDecorator & MethodDecorator;',
      'export declare function applyDecorators(...decorators: (ClassDecorator | MethodDecorator)[]): ClassDecorator & MethodDecorator;',
      'export declare function Module(metadata: unknown): ClassDecorator;',
      'export declare function Global(): ClassDecorator;',
      'export declare function forwardRef(callback: () => unknown): unknown;',
    ].join('\n'),
  );
}

export async function writeFakeNestMappedTypes(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/@nestjs/mapped-types/package.json', {
    name: '@nestjs/mapped-types',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/mapped-types/index.d.ts',
    [
      'export type Type<T> = abstract new (...args: any[]) => T;',
      'export declare function PartialType<T>(classRef: Type<T>): Type<Partial<T>>;',
    ].join('\n'),
  );
}

export async function writeFakeClassValidator(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/class-validator/package.json', {
    name: 'class-validator',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/class-validator/index.d.ts',
    [
      'export declare function IsOptional(): PropertyDecorator;',
      'export declare function IsString(): PropertyDecorator;',
      'export declare function MaxLength(value: number): PropertyDecorator;',
    ].join('\n'),
  );
}

export async function writeFakeNestCore(
  project: TestTypeScriptProject,
  version = '0.0.0-test',
): Promise<void> {
  await project.writeJson('node_modules/@nestjs/core/package.json', {
    name: '@nestjs/core',
    version,
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/core/index.d.ts',
    [
      'export declare const APP_GUARD: unique symbol;',
      'export interface INestApplication {',
      '  useGlobalGuards(...guards: unknown[]): void;',
      '  connectMicroservice<T = unknown>(options: T): INestMicroservice;',
      '  startAllMicroservices(): Promise<void>;',
      '  listen(port: unknown): Promise<void>;',
      '}',
      'export interface INestMicroservice { listen(): Promise<void>; }',
      'export declare class NestFactory {',
      '  static create(module: unknown): Promise<INestApplication>;',
      '  static createMicroservice<T = unknown>(',
      '    module: unknown,',
      '    options?: T,',
      '  ): Promise<INestMicroservice>;',
      '}',
    ].join('\n'),
  );
}

export async function writeFakeNestTypeOrm(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/@nestjs/typeorm/package.json', {
    name: '@nestjs/typeorm',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/typeorm/index.d.ts',
    'export declare function InjectRepository(entity: unknown): ParameterDecorator;\n',
  );
}

export async function writeFakeTypeOrm(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/typeorm/package.json', {
    name: 'typeorm',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/typeorm/index.d.ts',
    [
      'export declare function Entity(name?: string): ClassDecorator;',
      'export declare function Column(options?: unknown): PropertyDecorator;',
      'export declare function PrimaryColumn(options?: unknown): PropertyDecorator;',
      'export declare function PrimaryGeneratedColumn(options?: unknown): PropertyDecorator;',
      'export declare class Repository<T> {',
      '  createQueryBuilder(alias: string): SelectQueryBuilder<T>;',
      '  query<T = unknown[]>(sql: string, parameters?: unknown[]): Promise<T>;',
      '  sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;',
      '  find(): Promise<T[]>;',
      '  findOne(options: unknown): Promise<T | null>;',
      '  findOneBy(where: unknown): Promise<T | null>;',
      '  findBy(where: unknown): Promise<T[]>;',
      '  count(options?: unknown): Promise<number>;',
      '  exists(options?: unknown): Promise<boolean>;',
      '  save(value: unknown): Promise<T>;',
      '  insert(value: unknown): Promise<unknown>;',
      '  update(criteria: unknown, value: unknown): Promise<unknown>;',
      '  delete(criteria: unknown): Promise<unknown>;',
      '  remove(value: unknown): Promise<T>;',
      '  preload(value: unknown): Promise<T | undefined>;',
      '}',
      'export declare class DataSource {',
      '  createQueryBuilder<T>(entity?: unknown, alias?: string): SelectQueryBuilder<T>;',
      '  query<T = unknown[]>(sql: string, parameters?: unknown[]): Promise<T>;',
      '  sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;',
      '}',
      'export declare class EntityManager {',
      '  createQueryBuilder<T>(entity?: unknown, alias?: string): SelectQueryBuilder<T>;',
      '  query<T = unknown[]>(sql: string, parameters?: unknown[]): Promise<T>;',
      '  sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;',
      '}',
      'export declare class QueryRunner {',
      '  query<T = unknown[]>(sql: string, parameters?: unknown[]): Promise<T>;',
      '  sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;',
      '}',
      'export declare class SelectQueryBuilder<T> {',
      '  select(...args: unknown[]): this;',
      '  addSelect(...args: unknown[]): this;',
      '  from(target: unknown, alias: string): this;',
      '  addFrom(target: unknown, alias: string): this;',
      '  leftJoin(target: unknown, alias: string, condition?: string): this;',
      '  innerJoin(target: unknown, alias: string, condition?: string): this;',
      '  leftJoinAndSelect(target: unknown, alias: string, condition?: string): this;',
      '  innerJoinAndSelect(target: unknown, alias: string, condition?: string): this;',
      '  addCommonTableExpression(body: unknown, alias: string): this;',
      '  where(...args: unknown[]): this;',
      '  andWhere(...args: unknown[]): this;',
      '  orderBy(...args: unknown[]): this;',
      '  getOne(): Promise<T | null>;',
      '  getMany(): Promise<T[]>;',
      '  getRawOne(): Promise<unknown>;',
      '  getRawMany(): Promise<unknown[]>;',
      '  getCount(): Promise<number>;',
      '  stream(): Promise<unknown>;',
      '  getSql(): string;',
      '  getQuery(): string;',
      '  insert(): InsertQueryBuilder<T>;',
      '  update(entity?: unknown): UpdateQueryBuilder<T>;',
      '  delete(): DeleteQueryBuilder<T>;',
      '}',
      'export declare class InsertQueryBuilder<T> {',
      '  into(target: unknown): this;',
      '  values(value: unknown): this;',
      '  returning(value: unknown): this;',
      '  execute(): Promise<unknown>;',
      '}',
      'export declare class UpdateQueryBuilder<T> {',
      '  set(value: unknown): this;',
      '  where(...args: unknown[]): this;',
      '  returning(value: unknown): this;',
      '  execute(): Promise<unknown>;',
      '}',
      'export declare class DeleteQueryBuilder<T> {',
      '  from(target: unknown): this;',
      '  where(...args: unknown[]): this;',
      '  returning(value: unknown): this;',
      '  execute(): Promise<unknown>;',
      '}',
    ].join('\n'),
  );
}

export async function writeFakeAxios(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/axios/package.json', {
    name: 'axios',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/axios/index.d.ts',
    [
      'export interface AxiosRequestConfig {',
      '  url?: string;',
      '  method?: string;',
      '  baseURL?: string;',
      '  params?: unknown;',
      '  headers?: unknown;',
      '  adapter?: unknown;',
      '  transport?: unknown;',
      '  allowAbsoluteUrls?: boolean;',
      '}',
      'export interface AxiosInstance {',
      '  (config: AxiosRequestConfig): Promise<unknown>;',
      '  (url: string, config?: AxiosRequestConfig): Promise<unknown>;',
      '  request(config: AxiosRequestConfig): Promise<unknown>;',
      '  get(url: string, config?: AxiosRequestConfig): Promise<unknown>;',
      '  post(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<unknown>;',
      '  put(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<unknown>;',
      '  patch(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<unknown>;',
      '  delete(url: string, config?: AxiosRequestConfig): Promise<unknown>;',
      '  options(url: string, config?: AxiosRequestConfig): Promise<unknown>;',
      '  head(url: string, config?: AxiosRequestConfig): Promise<unknown>;',
      '}',
      'export interface AxiosStatic extends AxiosInstance {',
      '  create(config?: AxiosRequestConfig): AxiosInstance;',
      '}',
      'declare const axios: AxiosStatic;',
      'export { axios };',
      'export default axios;',
    ].join('\n'),
  );
}

export async function writeFakeUndici(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/undici/package.json', {
    name: 'undici',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/undici/index.d.ts',
    [
      'export interface RequestInit { method?: string; headers?: unknown; body?: unknown; }',
      'export declare function fetch(input: string, init?: RequestInit): Promise<unknown>;',
    ].join('\n'),
  );
}

export async function writeFakeRxjs(
  project: TestTypeScriptProject,
  version = '0.0.0-test',
): Promise<void> {
  await project.writeJson('node_modules/rxjs/package.json', {
    name: 'rxjs',
    version,
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/rxjs/index.d.ts',
    [
      'export interface Subscription { unsubscribe(): void; }',
      'export declare class Observable<T> {',
      '  pipe(...operators: unknown[]): Observable<T>;',
      '  subscribe(observer?: unknown): Subscription;',
      '}',
      'export declare function firstValueFrom<T>(source: Observable<T>): Promise<T>;',
      'export declare function lastValueFrom<T>(source: Observable<T>): Promise<T>;',
      'export declare function defer<T>(factory: () => Observable<T>): Observable<T>;',
      'export declare function map(project: (value: unknown) => unknown): unknown;',
    ].join('\n'),
  );
}

export async function writeFakeNestAxios(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/@nestjs/axios/package.json', {
    name: '@nestjs/axios',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/axios/index.d.ts',
    [
      "import type { AxiosInstance, AxiosRequestConfig } from 'axios';",
      "import type { Observable } from 'rxjs';",
      'export declare class HttpService {',
      '  readonly axiosRef: AxiosInstance;',
      '  request<T = unknown>(config: AxiosRequestConfig): Observable<T>;',
      '  get<T = unknown>(url: string, config?: AxiosRequestConfig): Observable<T>;',
      '  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Observable<T>;',
      '  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Observable<T>;',
      '  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Observable<T>;',
      '  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Observable<T>;',
      '  options<T = unknown>(url: string, config?: AxiosRequestConfig): Observable<T>;',
      '  head<T = unknown>(url: string, config?: AxiosRequestConfig): Observable<T>;',
      '}',
    ].join('\n'),
  );
}

export async function writeFakeCacheManager(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/cache-manager/package.json', {
    name: 'cache-manager',
    version: '7.2.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/cache-manager/index.d.ts',
    [
      'export interface Cache {',
      '  get<T = unknown>(key: string): Promise<T | undefined>;',
      '  set<T = unknown>(key: string, value: T, ttl?: number): Promise<T>;',
      '  del(key: string): Promise<boolean>;',
      '  wrap<T>(key: string, fn: () => Promise<T>, ttl?: number): Promise<T>;',
      '  clear(): Promise<void>;',
      '}',
    ].join('\n'),
  );
  await project.writeJson('node_modules/@nestjs/cache-manager/package.json', {
    name: '@nestjs/cache-manager',
    version: '3.0.1-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/cache-manager/index.d.ts',
    'export declare const CACHE_MANAGER: unique symbol;\n',
  );
}

export async function writeFakeIoredis(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/ioredis/package.json', {
    name: 'ioredis',
    version: '5.8.2-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/ioredis/index.d.ts',
    [
      'export default class Redis {',
      '  get(key: string): Promise<string | null>;',
      '  exists(key: string): Promise<number>;',
      '  ttl(key: string): Promise<number>;',
      '  pttl(key: string): Promise<number>;',
      '  type(key: string): Promise<string>;',
      '  set(key: string, value: unknown): Promise<string | null>;',
      '  setex(key: string, seconds: number, value: unknown): Promise<string>;',
      '  psetex(key: string, milliseconds: number, value: unknown): Promise<string>;',
      '  incr(key: string): Promise<number>;',
      '  incrby(key: string, increment: number): Promise<number>;',
      '  decr(key: string): Promise<number>;',
      '  decrby(key: string, decrement: number): Promise<number>;',
      '  append(key: string, value: unknown): Promise<number>;',
      '  del(...keys: string[]): Promise<number>;',
      '  unlink(...keys: string[]): Promise<number>;',
      '  expire(key: string, seconds: number): Promise<number>;',
      '  pexpire(key: string, milliseconds: number): Promise<number>;',
      '  expireat(key: string, timestamp: number): Promise<number>;',
      '  pexpireat(key: string, timestamp: number): Promise<number>;',
      '  persist(key: string): Promise<number>;',
      '  hget(key: string, field: string): Promise<string | null>;',
      '  hgetall(key: string): Promise<Record<string, string>>;',
      '  hexists(key: string, field: string): Promise<number>;',
      '  hset(key: string, field: string, value: unknown): Promise<number>;',
      '  hincrby(key: string, field: string, increment: number): Promise<number>;',
      '  hincrbyfloat(key: string, field: string, increment: number): Promise<string>;',
      '  hdel(key: string, ...fields: string[]): Promise<number>;',
      '  scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]>;',
      '  hscan(key: string, cursor: string, ...args: unknown[]): Promise<[string, string[]]>;',
      '  pipeline(): unknown;',
      '  eval(script: string): Promise<unknown>;',
      '  publish(channel: string, payload: unknown): Promise<number>;',
      '  keys(pattern: string): Promise<string[]>;',
      '}',
    ].join('\n'),
  );
}

export async function writeFakeRedlock(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/redlock/package.json', {
    name: 'redlock',
    version: '5.0.0-beta.2-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/redlock/index.d.ts',
    [
      'export interface ExecutionSignal { readonly aborted: boolean; readonly error?: Error; }',
      'export interface Settings { readonly retryCount?: number; }',
      'export default class Redlock {',
      '  using<T>(resources: readonly string[], duration: number, routine: (signal: ExecutionSignal) => Promise<T>): Promise<T>;',
      '  using<T>(resources: readonly string[], duration: number, settings: Settings, routine: (signal: ExecutionSignal) => Promise<T>): Promise<T>;',
      '}',
    ].join('\n'),
  );
}

export async function writeFakeNestConfig(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/@nestjs/config/package.json', {
    name: '@nestjs/config',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/config/index.d.ts',
    [
      'export declare class ConfigService {',
      '  get<T = unknown>(propertyPath: string): T | undefined;',
      '}',
    ].join('\n'),
  );
}

export async function writeFakeNodeProcess(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/@types/node/package.json', {
    name: '@types/node',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@types/node/index.d.ts',
    [
      'declare namespace NodeJS {',
      '  interface ProcessEnv { readonly [key: string]: string | undefined; }',
      '  interface Process { readonly env: ProcessEnv; }',
      '}',
      'declare const process: NodeJS.Process;',
    ].join('\n'),
  );
}

export async function writeFakeNestEventEmitter(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/@nestjs/event-emitter/package.json', {
    name: '@nestjs/event-emitter',
    version: '0.0.0-test',
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/event-emitter/index.d.ts',
    [
      'export type EventIdentity = string | symbol;',
      'export interface OnEventOptions { async?: boolean; suppressErrors?: boolean; }',
      'export declare class EventEmitter2 {',
      '  emit(event: EventIdentity, ...values: unknown[]): boolean;',
      '  emitAsync(event: EventIdentity, ...values: unknown[]): Promise<unknown[]>;',
      '  on(event: EventIdentity, listener: (...values: unknown[]) => void): this;',
      '}',
      'export declare class EventEmitterModule {',
      '  static forRoot(options?: unknown): unknown;',
      '}',
      'export declare function OnEvent(',
      '  event: EventIdentity | readonly EventIdentity[],',
      '  options?: OnEventOptions,',
      '): MethodDecorator;',
    ].join('\n'),
  );
}

export async function writeFakeBullMq(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/bullmq/package.json', {
    name: 'bullmq',
    version: DISTRIBUTED_STUB_VERSIONS.bullMq,
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/bullmq/index.d.ts',
    [
      'export interface Job<',
      '  DataType = unknown,',
      '  ReturnType = unknown,',
      '  NameType extends string = string,',
      '> {',
      '  readonly name: NameType;',
      '  readonly data: DataType;',
      '  readonly returnvalue?: ReturnType;',
      '}',
      'export declare class Queue<',
      '  DataType = unknown,',
      '  ResultType = unknown,',
      '  NameType extends string = string,',
      '> {',
      '  readonly name: string;',
      '  add(',
      '    name: NameType,',
      '    data: DataType,',
      '    options?: unknown,',
      '  ): Promise<Job<DataType, ResultType, NameType>>;',
      '}',
    ].join('\n'),
  );

  await project.writeJson('node_modules/@nestjs/bullmq/package.json', {
    name: '@nestjs/bullmq',
    version: DISTRIBUTED_STUB_VERSIONS.nestBullMq,
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/bullmq/index.d.ts',
    [
      "import type { Job } from 'bullmq';",
      'export interface ProcessorOptions {',
      '  readonly name?: string;',
      '  readonly scope?: unknown;',
      '}',
      'export declare function InjectQueue(name: string): ParameterDecorator;',
      'export declare function Processor(',
      '  nameOrOptions: string | ProcessorOptions,',
      '  workerOptions?: unknown,',
      '): ClassDecorator;',
      'export abstract class WorkerHost {',
      '  abstract process(',
      '    job: Job<unknown, unknown, string>,',
      '    token?: string,',
      '  ): Promise<unknown>;',
      '}',
      'export declare class BullModule {',
      '  static forRoot(options?: unknown): unknown;',
      '  static registerQueue(...options: readonly { readonly name: string }[]): unknown;',
      '  static registerQueueAsync(...options: readonly unknown[]): unknown;',
      '}',
    ].join('\n'),
  );
}

export async function writeFakeNestMicroservices(project: TestTypeScriptProject): Promise<void> {
  await project.writeJson('node_modules/@nestjs/microservices/package.json', {
    name: '@nestjs/microservices',
    version: DISTRIBUTED_STUB_VERSIONS.nest,
    types: 'index.d.ts',
  });
  await project.write(
    'node_modules/@nestjs/microservices/index.d.ts',
    [
      "import type { Observable } from 'rxjs';",
      'export declare enum Transport {',
      '  REDIS = 0,',
      '  TCP = 1,',
      '  NATS = 2,',
      '  MQTT = 3,',
      '  GRPC = 4,',
      '  RMQ = 5,',
      '  KAFKA = 6,',
      '}',
      'export interface MicroserviceOptions {',
      '  readonly transport?: Transport;',
      '  readonly options?: unknown;',
      '}',
      'export declare abstract class ClientProxy {',
      '  send<TResult = unknown, TInput = unknown>(',
      '    pattern: unknown,',
      '    data: TInput,',
      '  ): Observable<TResult>;',
      '  emit<TResult = unknown, TInput = unknown>(',
      '    pattern: unknown,',
      '    data: TInput,',
      '  ): Observable<TResult>;',
      '}',
      'export declare class ClientsModule {',
      '  static register(',
      '    clients: readonly {',
      '      readonly name: string | symbol;',
      '      readonly transport?: Transport;',
      '      readonly options?: unknown;',
      '    }[],',
      '  ): unknown;',
      '}',
      'export declare function MessagePattern(',
      '  pattern: unknown,',
      '  transport?: Transport,',
      '): MethodDecorator;',
      'export declare function EventPattern(',
      '  pattern: unknown,',
      '  transport?: Transport,',
      '): MethodDecorator;',
      'export declare function Payload(property?: string): ParameterDecorator;',
      'export declare function Ctx(): ParameterDecorator;',
    ].join('\n'),
  );
}
