[**anothertodo API**](../README.md)

***

[anothertodo API](../README.md) / DomainEvents

# Type Alias: DomainEvents

> **DomainEvents** = `object`

## Properties

### config.reloaded

> **config.reloaded**: `object`

#### config

> **config**: [`Config`](Config.md)

***

### reminder.due

> **reminder.due**: `object`

#### missed

> **missed**: `boolean`

#### reminderIndex

> **reminderIndex**: `number`

#### task

> **task**: [`Task`](Task.md)

***

### reminder.fired

> **reminder.fired**: `object`

#### reminderIndex

> **reminderIndex**: `number`

#### taskId

> **taskId**: `string`

***

### sync.completed

> **sync.completed**: `object`

#### summary

> **summary**: `SyncSummary`

***

### sync.failed

> **sync.failed**: `object`

#### error

> **error**: `Error`

***

### task.created

> **task.created**: `object`

#### task

> **task**: [`Task`](Task.md)

***

### task.deleted

> **task.deleted**: `object`

#### task

> **task**: [`Task`](Task.md)

#### tombstone

> **tombstone**: [`Tombstone`](Tombstone.md)

***

### task.restored

> **task.restored**: `object`

#### task

> **task**: [`Task`](Task.md)

***

### task.updated

> **task.updated**: `object`

#### after

> **after**: [`Task`](Task.md)

#### before

> **before**: [`Task`](Task.md)
