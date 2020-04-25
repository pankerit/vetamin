import React, { useEffect, useReducer, useRef } from 'react'

export type State = Record<string | number | symbol, any>
export type PartialState<T extends State> = Partial<T> | ((state: T) => Partial<T>)
export type SetState<T extends State> = (partial: PartialState<T>) => void
export type Callback<T> = (state: T | null) => void
export type Selector<T extends State, U> = (state: T) => U
export type EqualityChecker<T> = (state: T, newState: any) => boolean

export type SubscriberListener<T extends State> = <U>(subscriber: SubscriberWrapper<T, U>) => () => void

export interface SubscriberWrapper<T extends State, U> {
  callback: Callback<U>
  selector: Selector<T, U>
  equalityFn: EqualityChecker<U>
  error: ''
  currentSlice: U
  unsubscribe: () => void
}

export type Subscribe<T extends State> = <U>(
  callback: Callback<U>,
  selector?: Selector<T, U>,
  equalityFn?: EqualityChecker<U>
) => () => void

export interface UseStore<T extends State> {
  (): T
  <U>(selector: Selector<T, U>, equalityFn?: EqualityChecker<U>): U
}
export type WithStore<T extends State> = <U>(selector: Selector<T, U>, equalityFn: EqualityChecker<U>) => any

type TipaAction<T extends State> = {
  [K: string]: (state: T, payload?: any) => Partial<T>
}
type StoreActio<T extends TipaAction<State>> = {
  [K in keyof T]: (payload: Parameters<T[K]>[1]) => void
}

class CreateStore<TState extends State, TAction extends TipaAction<TState>> {
  private state: TState
  private listeners: Set<() => any>
  actions!: StoreActio<TAction>

  constructor({ state, action, name }: { state: TState; action?: TAction; name?: string }) {
    this.state = { ...state }
    this.listeners = new Set()

    if (action) {
      const reduxExtension = (window as any).__REDUX_DEVTOOLS_EXTENSION__
      if (!reduxExtension) {
        console.warn('Please install/enable Redux devtools extension')
      }
      const devtool = reduxExtension.connect({ name })
      console.log(name)
      //@ts-ignore
      this.actions = {}
      for (let key in action) {
        console.log(action[key])
        this.actions[key] = payload => {
          this.set(action[key](this.state, payload))
          devtool.send(key, this.state)
        }
      }

      devtool.init(this.state)
    }
  }

  getState = () => this.state

  set: SetState<TState> = state => {
    if (typeof state === 'function') {
      this.state = { ...this.state, ...state(this.state) }
    } else {
      this.state = { ...this.state, ...state }
    }

    this.listeners.forEach(listener => listener())
  }
  // private
  private subscriberWrapper = <StateSlice,>(
    callback: Callback<StateSlice>,
    selector: Selector<TState, StateSlice> = this.getState,
    equalityFn: EqualityChecker<StateSlice> = Object.is
  ): SubscriberWrapper<TState, StateSlice> => ({
    callback,
    selector,
    equalityFn,
    error: '',
    currentSlice: selector(this.state),
    unsubscribe: () => {},
  })
  // private
  private subscriberListener: SubscriberListener<TState> = <T,>(subscriber: SubscriberWrapper<TState, T>) => {
    const listener = () => {
      // Selector or equality function could throw but we don't want to stop
      // the listener from being called.
      const newStateSlice = subscriber.selector(this.state)
      if (!subscriber.equalityFn(subscriber.currentSlice, newStateSlice)) {
        subscriber.callback((subscriber.currentSlice = newStateSlice))
      }
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribe: Subscribe<TState> = <T,>(callback: Callback<T>, selector?: Selector<TState, T>, equalityFn?: EqualityChecker<T>) =>
    this.subscriberListener(this.subscriberWrapper(callback, selector, equalityFn))

  use: UseStore<TState> = <T,>(selector: Selector<TState, T> = this.getState, equalityFn: EqualityChecker<T> = Object.is) => {
    const forceUpdate: Callback<T> = useReducer(c => c + 1, 0)[1]
    const subscriberRef = useRef<SubscriberWrapper<TState, T>>()

    if (!subscriberRef.current) {
      subscriberRef.current = this.subscriberWrapper(forceUpdate, selector, equalityFn)
      subscriberRef.current.unsubscribe = this.subscriberListener(subscriberRef.current)
    }

    useEffect(() => subscriberRef.current?.unsubscribe, [])
    return subscriberRef.current.currentSlice
  }

  with: WithStore<TState> = <T, P extends object>(
    selector: Selector<TState, T> = this.getState,
    equalityFn: EqualityChecker<T> = Object.is
  ) => (WrappedComponent: React.ComponentType<T & P>) => {
    const self = this
    return class WithStore extends React.Component<P & T> {
      private subscriber: SubscriberWrapper<TState, T>
      constructor(props: T & P) {
        super(props)
        this.subscriber = self.subscriberWrapper(() => this.forceUpdate(), selector, equalityFn)
        this.subscriber.unsubscribe = self.subscriberListener(this.subscriber)
      }
      componentWillUnmount() {
        this.subscriber.unsubscribe()
      }
      render() {
        return <WrappedComponent {...this.props} {...this.subscriber.currentSlice} />
      }
    }
  }
}

export default CreateStore
