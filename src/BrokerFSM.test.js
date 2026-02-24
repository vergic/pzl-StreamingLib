import { initBrokerConnectionFsm } from './BrokerFSM';

function createMockExternals() {
  return {
    _connect: jest.fn(),
    reSubscribeAll: jest.fn(),
    unSubscribeAll: jest.fn(),
  };
}

function createMockDebug() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  };
}

describe('BrokerFSM', () => {
  let externals;
  let debug;

  beforeEach(() => {
    externals = createMockExternals();
    debug = createMockDebug();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts in disconnected state', () => {
    const fsm = initBrokerConnectionFsm(externals, {}, debug);
    expect(fsm.getState()).toBe('disconnected');
  });

  it('transitions to connecting when connect is handled', () => {
    const fsm = initBrokerConnectionFsm(externals, {}, debug);
    fsm.handle('connect');
    expect(fsm.getState()).toBe('connecting');
    expect(externals._connect).toHaveBeenCalled();
  });

  it('transitions to connected when connection_ok is handled with connection', () => {
    const fsm = initBrokerConnectionFsm(externals, {}, debug);
    fsm.handle('connect');
    const mockConnection = { state: 'connected' };
    fsm.handle('connection_ok', mockConnection);

    expect(fsm.getState()).toBe('connected');
    expect(fsm.getConnection()).toBe(mockConnection);
  });

  it('transitions to disconnected when connection_failed during connecting', () => {
    const fsm = initBrokerConnectionFsm(externals, {}, debug);
    fsm.handle('connect');
    fsm.handle('connection_failed', new Error('failed'));

    expect(fsm.getState()).toBe('disconnected');
  });

  it('invokes onConnectionStarted when entering connected', () => {
    const onConnectionStarted = jest.fn();
    const fsm = initBrokerConnectionFsm(
      externals,
      { onConnectionStarted },
      debug
    );
    fsm.handle('connect');
    fsm.handle('connection_ok', { conn: true });

    expect(onConnectionStarted).toHaveBeenCalledWith({ conn: true });
  });

  it('transitions to disconnecting when disconnect handled from connected', () => {
    const mockConnection = {
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const fsm = initBrokerConnectionFsm(externals, {}, debug);
    fsm.handle('connect');
    fsm.handle('connection_ok', mockConnection);
    fsm.handle('disconnect');

    expect(fsm.getState()).toBe('disconnecting');
    expect(externals.unSubscribeAll).toHaveBeenCalled();
    expect(mockConnection.stop).toHaveBeenCalled();
  });

  it('transitions to disconnected when connection.stop completes', async () => {
    const mockConnection = {
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const onDisconnected = jest.fn();
    const fsm = initBrokerConnectionFsm(
      externals,
      { onDisconnected },
      debug
    );
    fsm.handle('connect');
    fsm.handle('connection_ok', mockConnection);
    fsm.handle('disconnect');

    await jest.runAllTimersAsync();

    expect(fsm.getState()).toBe('disconnected');
    expect(onDisconnected).toHaveBeenCalled();
  });

  it('transitions to reconnect_wait when connection_failed from connected', () => {
    const onConnectionFailed = jest.fn();
    const fsm = initBrokerConnectionFsm(
      externals,
      { onConnectionFailed },
      debug
    );
    fsm.handle('connect');
    fsm.handle('connection_ok', {});
    fsm.handle('connection_failed');

    expect(fsm.getState()).toBe('reconnect_wait');
    expect(onConnectionFailed).toHaveBeenCalledWith('connection failed');
  });

  it('emits transition events for listeners', () => {
    const transitionListener = jest.fn();
    const fsm = initBrokerConnectionFsm(externals, {}, debug);

    const unsub = fsm.on('transition', transitionListener);
    fsm.handle('connect');

    expect(transitionListener).toHaveBeenCalledWith({
      fromState: 'disconnected',
      toState: 'connecting',
    });

    unsub.off();
    transitionListener.mockClear();
    fsm.handle('connection_ok', {});

    expect(transitionListener).not.toHaveBeenCalled();
  });

  it('transitions to reconnecting then connected on successful reconnect', async () => {
    const fsm = initBrokerConnectionFsm(externals, {}, debug);
    fsm.handle('connect');
    fsm.handle('connection_ok', {});
    fsm.handle('connection_failed');

    expect(fsm.getState()).toBe('reconnect_wait');

    await jest.advanceTimersByTimeAsync(10 * 1000); // reconnectRetryDelay = 10 sec

    expect(fsm.getState()).toBe('reconnecting');
    expect(externals._connect).toHaveBeenCalledTimes(2);

    fsm.handle('connection_ok', { reconnected: true });
    expect(fsm.getState()).toBe('connected');
    expect(fsm.getConnection()).toEqual({ reconnected: true });
  });
});
