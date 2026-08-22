[**anothertodo API**](../README.md)

***

[anothertodo API](../README.md) / ApplicationService

# Class: ApplicationService

Application operations shared by CLI and TUI; presentation layers do not mutate tasks themselves.

## Constructors

### Constructor

> **new ApplicationService**(`store`): `ApplicationService`

#### Parameters

##### store

`Store`

#### Returns

`ApplicationService`

## Properties

### store

> `readonly` **store**: `Store`

## Methods

### add()

> **add**(`input`, `now?`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### input

`string`

##### now?

`string` = `...`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

***

### archive()

> **archive**(`days?`): `Promise`\<`number`\>

#### Parameters

##### days?

`number` = `14`

#### Returns

`Promise`\<`number`\>

***

### children()

> **children**(`id`): `Promise`\<`object`[]\>

直接找子任务；id 是全长的，父字段里存的也是全长 id

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`object`[]\>

***

### complete()

> **complete**(`idOrPrefix`, `options?`): `Promise`\<`CompleteResult`\>

完成一个任务，顺带处理两件只有在这里才知道该怎么做的事：
重复任务要派生下一次，父任务完成时要交代还开着的子任务。

#### Parameters

##### idOrPrefix

`string`

##### options?

###### cascade?

`boolean`

###### now?

`string`

#### Returns

`Promise`\<`CompleteResult`\>

***

### config()

> **config**(): `Promise`\<\{ `agenda`: \{ `date_format`: `"auto"` \| `"md"` \| `"full"`; `week_days`: `number`; \}; `email`: \{ `from`: `string`; `host`: `string`; `password`: `string`; `port`: `number`; `ssl`: `boolean`; `to`: `string`; `user`: `string`; \}; `priority`: \{ `levels`: `string`[]; `mode`: `"levels"` \| `"urgency"`; `urgency`: \{ `age_cap`: `number`; `age_per_day`: `number`; `due_today`: `number`; `due_week_decay`: `number`; `overdue`: `number`; `per_level`: `number`; `waiting_penalty`: `number`; \}; \}; `ui`: \{ `lang`: `"auto"` \| `"zh"` \| `"en"`; \}; `watch`: \{ `interval_seconds`: `number`; \}; \}\>

#### Returns

`Promise`\<\{ `agenda`: \{ `date_format`: `"auto"` \| `"md"` \| `"full"`; `week_days`: `number`; \}; `email`: \{ `from`: `string`; `host`: `string`; `password`: `string`; `port`: `number`; `ssl`: `boolean`; `to`: `string`; `user`: `string`; \}; `priority`: \{ `levels`: `string`[]; `mode`: `"levels"` \| `"urgency"`; `urgency`: \{ `age_cap`: `number`; `age_per_day`: `number`; `due_today`: `number`; `due_week_decay`: `number`; `overdue`: `number`; `per_level`: `number`; `waiting_penalty`: `number`; \}; \}; `ui`: \{ `lang`: `"auto"` \| `"zh"` \| `"en"`; \}; `watch`: \{ `interval_seconds`: `number`; \}; \}\>

***

### deferUntil()

> **deferUntil**(`idOrPrefix`, `date`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

押后到指定日期；TUI 的 w 和 CLI 的 wait 都走这里

#### Parameters

##### idOrPrefix

`string`

##### date

`string`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

***

### deferUntilTomorrow()

> **deferUntilTomorrow**(`idOrPrefix`, `today?`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### idOrPrefix

`string`

##### today?

`string` = `...`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

***

### edit()

> **edit**(`idOrPrefix`, `input`, `now?`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### idOrPrefix

`string`

##### input

`string`

##### now?

`string` = `...`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

***

### remove()

> **remove**(`idOrPrefix`): `Promise`\<`void`\>

#### Parameters

##### idOrPrefix

`string`

#### Returns

`Promise`\<`void`\>

***

### reopen()

> **reopen**(`idOrPrefix`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### idOrPrefix

`string`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

***

### restore()

> **restore**(`idOrPrefix`): `Promise`\<`Record`\<`string`, `unknown`\>\>

#### Parameters

##### idOrPrefix

`string`

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\>\>

***

### setStatus()

> **setStatus**(`idOrPrefix`, `status`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### idOrPrefix

`string`

##### status

`TaskStatus`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `recur?`: \{ `interval`: `number`; `kind`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"` \| `"weekdays"`; `weekday?`: `number`; \}; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

***

### snooze()

> **snooze**(`idOrPrefix`, `minutes`): `Promise`\<`void`\>

#### Parameters

##### idOrPrefix

`string`

##### minutes

`number`

#### Returns

`Promise`\<`void`\>

***

### sync()

> **sync**(): `Promise`\<`string`\>

#### Returns

`Promise`\<`string`\>

***

### tasks()

> **tasks**(): `Promise`\<`object`[]\>

#### Returns

`Promise`\<`object`[]\>

***

### undo()

> **undo**(): `Promise`\<`string`\>

#### Returns

`Promise`\<`string`\>
