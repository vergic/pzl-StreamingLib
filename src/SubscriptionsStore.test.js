import * as SubscriptionsStore from './SubscriptionsStore';

function createMockSubscription(id) {
  return {
    getSubscriptionId: () => id,
  };
}

describe('SubscriptionsStore', () => {
  beforeEach(() => {
    SubscriptionsStore.removeAll();
  });

  describe('add', () => {
    it('adds a subscription', () => {
      const sub = createMockSubscription('topic-1');
      SubscriptionsStore.add(sub);
      expect(SubscriptionsStore.getAll()).toHaveLength(1);
      expect(SubscriptionsStore.get(sub)).toEqual(sub);
    });

    it('removes existing subscription before adding (re-add replaces)', () => {
      const sub1 = createMockSubscription('topic-1');
      const sub2 = createMockSubscription('topic-1'); // same id
      SubscriptionsStore.add(sub1);
      SubscriptionsStore.add(sub2);
      expect(SubscriptionsStore.getAll()).toHaveLength(1);
      expect(SubscriptionsStore.get(sub2)).toEqual(sub2);
    });
  });

  describe('get', () => {
    it('returns subscription when found by reference', () => {
      const sub = createMockSubscription('topic-1');
      SubscriptionsStore.add(sub);
      expect(SubscriptionsStore.get(sub)).toEqual(sub);
    });

    it('returns null when subscription not in store', () => {
      const sub = createMockSubscription('topic-1');
      expect(SubscriptionsStore.get(sub)).toBeNull();
    });

    it('returns null for null/undefined subscription', () => {
      expect(SubscriptionsStore.get(null)).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns subscription by id string', () => {
      const sub = createMockSubscription('topic-1');
      SubscriptionsStore.add(sub);
      expect(SubscriptionsStore.findById('topic-1')).toEqual(sub);
    });

    it('returns null when no match', () => {
      expect(SubscriptionsStore.findById('nonexistent')).toBeNull();
    });

    it('returns null for falsy id', () => {
      expect(SubscriptionsStore.findById(null)).toBeNull();
      expect(SubscriptionsStore.findById('')).toBeNull();
    });
  });

  describe('exists', () => {
    it('returns true when subscription is in store', () => {
      const sub = createMockSubscription('topic-1');
      SubscriptionsStore.add(sub);
      expect(SubscriptionsStore.exists(sub)).toBe(true);
    });

    it('returns false when subscription is not in store', () => {
      const sub = createMockSubscription('topic-1');
      expect(SubscriptionsStore.exists(sub)).toBe(false);
    });
  });

  describe('remove', () => {
    it('removes subscription by reference', () => {
      const sub = createMockSubscription('topic-1');
      SubscriptionsStore.add(sub);
      expect(SubscriptionsStore.remove(sub)).toBe(true);
      expect(SubscriptionsStore.get(sub)).toBeNull();
    });

    it('returns false when subscription is not an object', () => {
      expect(SubscriptionsStore.remove(null)).toBe(false);
      expect(SubscriptionsStore.remove('topic-1')).toBe(false);
    });
  });

  describe('removeAll', () => {
    it('clears all subscriptions', () => {
      SubscriptionsStore.add(createMockSubscription('a'));
      SubscriptionsStore.add(createMockSubscription('b'));
      SubscriptionsStore.removeAll();
      expect(SubscriptionsStore.getAll()).toEqual([]);
    });
  });
});
