[**anothertodo API**](../README.md)

***

[anothertodo API](../README.md) / DomainEventBus

# Class: DomainEventBus

Post-commit notifications only; subscriber failures never roll back storage.

## Constructors

### Constructor

> **new DomainEventBus**(`onSubscriberError?`): `DomainEventBus`

#### Parameters

##### onSubscriberError?

(`error`) => `void`

#### Returns

`DomainEventBus`

## Methods

### emit()

> **emit**\<`K`\>(`event`, `payload`): `void`

#### Type Parameters

##### K

`K` *extends* keyof [`DomainEvents`](../type-aliases/DomainEvents.md)

#### Parameters

##### event

`K`

##### payload

[`DomainEvents`](../type-aliases/DomainEvents.md)\[`K`\]

#### Returns

`void`

***

### on()

> **on**\<`K`\>(`event`, `listener`): () => `void`

#### Type Parameters

##### K

`K` *extends* keyof [`DomainEvents`](../type-aliases/DomainEvents.md)

#### Parameters

##### event

`K`

##### listener

`Listener`\<[`DomainEvents`](../type-aliases/DomainEvents.md)\[`K`\]\>

#### Returns

() => `void`
