/** 时间必须注入：domain/application 里不允许出现 Date.now() */
export interface Clock {
  now(): Date;
}
