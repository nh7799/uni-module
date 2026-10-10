export type Kind = 'official'|'personal'|'warning'|'milestone'
export interface EventRow { id:string; title:string; date:string; kind:Kind; done:boolean }
export interface Task { id:string; title:string; tier:'core'|'important'|'optional'|'stretch'; status:'todo'|'done'; due:string|null; parent_id?:string|null; notes?:string|null }
export interface Daily { id:string; day:string; mission:string|null; objective:string|null; biggest_win:string|null; biggest_challenge:string|null; learned:string|null; first_task_tomorrow:string|null; completed:boolean }
export interface Decision { id:string; question:string; chosen:string|null; reason:string|null; alternatives:string|null; confidence:number|null; decided_on:string }
export interface Blocker { id:string; title:string; severity:'low'|'medium'|'high'; status:'open'|'resolved'; next_action:string|null }
