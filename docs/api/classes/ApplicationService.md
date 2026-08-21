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

> **add**(`input`, `now?`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### input

`string`

##### now?

`string` = `...`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

***

### archive()

> **archive**(`days?`): `Promise`\<`number`\>

#### Parameters

##### days?

`number` = `14`

#### Returns

`Promise`\<`number`\>

***

### config()

> **config**(): `Promise`\<\{ `agenda`: \{ `date_format`: `"auto"` \| `"md"` \| `"full"`; `week_days`: `number`; \}; `email`: \{ `from`: `string`; `host`: `string`; `password`: `string`; `port`: `number`; `ssl`: `boolean`; `to`: `string`; `user`: `string`; \}; `priority`: \{ `levels`: `string`[]; `mode`: `"levels"` \| `"urgency"`; `urgency`: \{ `age_cap`: `number`; `age_per_day`: `number`; `due_today`: `number`; `due_week_decay`: `number`; `overdue`: `number`; `per_level`: `number`; `waiting_penalty`: `number`; \}; \}; `watch`: \{ `interval_seconds`: `number`; \}; \}\>

#### Returns

`Promise`\<\{ `agenda`: \{ `date_format`: `"auto"` \| `"md"` \| `"full"`; `week_days`: `number`; \}; `email`: \{ `from`: `string`; `host`: `string`; `password`: `string`; `port`: `number`; `ssl`: `boolean`; `to`: `string`; `user`: `string`; \}; `priority`: \{ `levels`: `string`[]; `mode`: `"levels"` \| `"urgency"`; `urgency`: \{ `age_cap`: `number`; `age_per_day`: `number`; `due_today`: `number`; `due_week_decay`: `number`; `overdue`: `number`; `per_level`: `number`; `waiting_penalty`: `number`; \}; \}; `watch`: \{ `interval_seconds`: `number`; \}; \}\>

***

### deferUntilTomorrow()

> **deferUntilTomorrow**(`idOrPrefix`, `today?`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### idOrPrefix

`string`

##### today?

`string` = `...`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

***

### edit()

> **edit**(`idOrPrefix`, `input`, `now?`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### idOrPrefix

`string`

##### input

`string`

##### now?

`string` = `...`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

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

> **reopen**(`idOrPrefix`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### idOrPrefix

`string`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

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

> **setStatus**(`idOrPrefix`, `status`): `Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

#### Parameters

##### idOrPrefix

`string`

##### status

`"todo"` \| `"done"` \| `"waiting"`

#### Returns

`Promise`\<\{ `due?`: `string`; `end?`: `string`; `entry`: `string`; `id`: `string`; `modified`: `string`; `notes`: `string`; `parent?`: `string`; `priority?`: `string`; `project?`: `string`; `reminders`: `object`[]; `status`: `string`; `tags`: `string`[]; `title`: `string`; `wait?`: `string`; \}\>

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
