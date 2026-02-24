import StreamSubscription from './StreamSubscription';

describe('StreamSubscription', () => {
  describe('defaults', () => {
    it('has default options when created with empty object', () => {
      const sub = new StreamSubscription({});
      expect(sub.options).toMatchObject({
        topicProperty: 'topic',
        topicStartEventId: 1,
        eventIdProperty: 'id',
        getMethod: 'Get',
        streamMethod: 'Subscribe',
      });
    });

    it('has default top-level properties', () => {
      const sub = new StreamSubscription({});
      expect(sub.topic).toBe('');
      expect(sub.fromEventId).toBeNull();
      expect(sub.subscribeInvocationId).toBe(-1);
      expect(sub.subscriberRef).toBeNull();
      expect(sub.lastReceivedEventId).toBe(-1);
      expect(typeof sub.onDataReceived).toBe('function');
      expect(sub.onSubscriptionStart).toBeNull();
      expect(sub.onSubscriptionEnd).toBeNull();
    });
  });

  describe('getSubscriptionId', () => {
    it('returns topic value by default', () => {
      const sub = new StreamSubscription({ topic: 'my-topic' });
      expect(sub.getSubscriptionId()).toBe('my-topic');
    });

    it('returns value of options.topicProperty when overridden', () => {
      const sub = new StreamSubscription({
        options: { topicProperty: 'channel' },
        channel: 'my-channel',
      });
      expect(sub.getSubscriptionId()).toBe('my-channel');
    });
  });

  describe('toString', () => {
    it('returns same as getSubscriptionId', () => {
      const sub = new StreamSubscription({ topic: 'topic-123' });
      expect(sub.toString()).toBe('topic-123');
      expect(sub.toString()).toBe(sub.getSubscriptionId());
    });
  });

  describe('prop override', () => {
    it('overrides topic with passed value', () => {
      const sub = new StreamSubscription({ topic: 'conversation::123' });
      expect(sub.topic).toBe('conversation::123');
    });

    it('overrides fromEventId with passed value', () => {
      const sub = new StreamSubscription({ fromEventId: 42 });
      expect(sub.fromEventId).toBe(42);
    });

    it('overrides onDataReceived with custom function', () => {
      const handler = jest.fn();
      const sub = new StreamSubscription({ onDataReceived: handler });
      sub.onDataReceived(['event1']);
      expect(handler).toHaveBeenCalledWith(['event1']);
    });
  });

  describe('options merge', () => {
    it('applies option overrides via mergeDeep', () => {
      const sub = new StreamSubscription({
        options: { eventIdProperty: 'eventId' },
      });
      expect(sub.options.eventIdProperty).toBe('eventId');
      // mergeDeep replaces when overwriting primitives; full options object pass preserves all
    });

    it('preserves defaults when passing full options object', () => {
      const sub = new StreamSubscription({
        options: {
          topicProperty: 'topic',
          topicStartEventId: 1,
          eventIdProperty: 'eventId',
          getMethod: 'Fetch',
          streamMethod: 'Stream',
        },
      });
      expect(sub.options.eventIdProperty).toBe('eventId');
      expect(sub.options.getMethod).toBe('Fetch');
      expect(sub.options.streamMethod).toBe('Stream');
      expect(sub.options.topicProperty).toBe('topic');
    });
  });

  describe('SubscriptionsStore integration', () => {
    it('two subscriptions with same topic have same getSubscriptionId', () => {
      const sub1 = new StreamSubscription({ topic: 'conversation::abc' });
      const sub2 = new StreamSubscription({ topic: 'conversation::abc' });
      expect(sub1.getSubscriptionId()).toBe(sub2.getSubscriptionId());
    });

    it('subscriptions with different topics have different getSubscriptionId', () => {
      const sub1 = new StreamSubscription({ topic: 'conversation::a' });
      const sub2 = new StreamSubscription({ topic: 'conversation::b' });
      expect(sub1.getSubscriptionId()).not.toBe(sub2.getSubscriptionId());
    });
  });
});
