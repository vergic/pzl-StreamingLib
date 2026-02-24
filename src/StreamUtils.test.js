import {
  mergeDeep,
  retryPromiseFunc,
  promiseTimeout,
  safeLocalStorageGet,
  noDebug,
} from './StreamUtils';

describe('StreamUtils', () => {
  describe('mergeDeep', () => {
    it('returns empty object when no arguments', () => {
      expect(mergeDeep()).toEqual({});
    });

    it('merges shallow objects - later overwrites when key exists in both', () => {
      // Note: when prev has no key, mergeDeep replaces prev with obj for that key
      expect(mergeDeep({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    });

    it('handles single object', () => {
      expect(mergeDeep({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    });

    it('merges arrays with unique elements (Set deduplication)', () => {
      const result = mergeDeep({ arr: [1, 2] }, { arr: [2, 3] });
      expect(result.arr).toHaveLength(3);
      expect(result.arr.sort()).toEqual([1, 2, 3]);
    });

    it('overwrites object with primitive when merging', () => {
      expect(mergeDeep({ a: { nested: 1 } }, { a: 5 })).toEqual({ a: 5 });
    });

    it('deep merges nested objects - later object extends/overwrites', () => {
      // Implementation: when both pVal and oVal are objects, recurses; else later wins
      const result = mergeDeep({ a: { x: 1 } }, { a: { y: 2 } });
      expect(result).toHaveProperty('a');
      expect(result.a).toHaveProperty('y', 2);
    });
  });

  describe('retryPromiseFunc', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resolves immediately when promisedFunction succeeds on first try', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = retryPromiseFunc(fn, 100, 3, 'abort');
      await expect(result).resolves.toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and resolves when succeeding', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success');

      const promise = retryPromiseFunc(fn, 100, 3, 'abort');
      await jest.advanceTimersByTimeAsync(100);
      await expect(promise).resolves.toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('rejects when maxRetries exhausted', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));
      const promise = retryPromiseFunc(fn, 50, 3, 'abort');
      const catchFn = jest.fn();
      promise.catch(catchFn);

      await jest.runAllTimersAsync();

      expect(catchFn).toHaveBeenCalledTimes(1);
      expect(catchFn.mock.calls[0][0].message).toBe('always fails');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry when rejected with abortReason', async () => {
      const fn = jest.fn().mockRejectedValue('abort');
      const promise = retryPromiseFunc(fn, 100, 5, 'abort');

      await expect(promise).rejects.toBe('abort');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('promiseTimeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resolves with promise result when promise resolves before timeout', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('done'), 50);
      });
      const result = promiseTimeout(slowPromise, 200);

      jest.advanceTimersByTime(50);
      await expect(result).resolves.toBe('done');
    });

    it('rejects with timeout error when promise is too slow', async () => {
      const slowPromise = new Promise(() => {}); // never resolves
      const result = promiseTimeout(slowPromise, 100);

      jest.advanceTimersByTime(100);
      await expect(result).rejects.toThrow('timeout');
    });
  });

  describe('safeLocalStorageGet', () => {
    it('returns undefined when localStorage is not available (Node env)', () => {
      expect(safeLocalStorageGet('key')).toBeUndefined();
    });

    it('returns value when localStorage is available', () => {
      const originalLocalStorage = global.localStorage;
      global.localStorage = {
        getItem: jest.fn().mockReturnValue('stored-value'),
      };

      expect(safeLocalStorageGet('myKey')).toBe('stored-value');
      expect(global.localStorage.getItem).toHaveBeenCalledWith('myKey');

      global.localStorage = originalLocalStorage;
    });

    it('passes key to getItem when localStorage is available', () => {
      const originalLocalStorage = global.localStorage;
      global.localStorage = {
        getItem: jest.fn().mockReturnValue(null),
      };

      safeLocalStorageGet('someKey');
      expect(global.localStorage.getItem).toHaveBeenCalledWith('someKey');

      global.localStorage = originalLocalStorage;
    });
  });

  describe('noDebug', () => {
    it('has no-op methods that do not throw', () => {
      expect(() => {
        noDebug.log('x');
        noDebug.warn('y');
        noDebug.error('z');
        noDebug.info('w');
      }).not.toThrow();
    });

    it('has debugDisabled true', () => {
      expect(noDebug.debugDisabled).toBe(true);
    });
  });
});
