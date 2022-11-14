// deno-lint-ignore-file require-await
type Dispatch<T> = (payload: T) => void;
type Complete = () => void;
type Unsubscribe = () => void;

type Subscribe<T> = (
  dispatch: Dispatch<T>,
  complete: () => void,
) => Promise<Unsubscribe>;

class Signal<T> {
  constructor(public subscribe: Subscribe<T>) {
  }

  map<U>(fn: (payload: T) => U) {
    return new Signal<U>((dispatch, complete) => {
      return this.subscribe((payload) => {
        dispatch(fn(payload));
      }, complete);
    });
  }
  filter(fn: (payload: T) => boolean) {
    return new Signal<T>((dispatch, complete) => {
      return this.subscribe((payload) => {
        const predicate = fn(payload);
        if (predicate) {
          dispatch(payload);
        }
      }, complete);
    });
  }
  static loop<T>(handler: (source: Signal<T>) => Signal<T>): Signal<T> {
    return new Signal<T>(async (dispatch, complete) => {
      const source = new Subject<T>();
      await source.subscribe(dispatch, complete);

      const sink = handler(source);
      const unsubSink = await sink.subscribe(
        source.dispatch.bind(source),
        source.complete.bind(source),
      );

      return () => {
        source.complete();
        unsubSink();
      };
    });
  }

  static of<T>(...payloads: T[]) {
    return new Signal<T>(async (dispatch, complete) => {
      for (const payload of payloads) {
        dispatch(payload);
      }
      complete();
      return () => {};
    });
  }

  static merge<T>(...signals: Signal<T>[]) {
    return new Signal<T>(async (dispatch, complete) => {
      let counter = signals.length;
      let completed = false;

      const unsubs = await Promise.all(signals.map((signal) => {
        return signal.subscribe(dispatch, () => {
          if (--counter <= 0 && !completed) {
            complete();
            completed = true;
          }
        });
      }));

      return () => {
        unsubs.forEach((unsub) => {
          unsub();
        });
      };
    });
  }
}

class Subject<T> extends Signal<T> {
  private dispatchs = new Set<Dispatch<T>>();
  private completes = new Set<Complete>();

  constructor() {
    super(async (dispatch, complete) => {
      this.dispatchs.add(dispatch);
      this.completes.add(complete);

      return () => {
        this.dispatchs.delete(dispatch);
        this.completes.delete(complete);
      };
    });
  }

  dispatch(payload: T) {
    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        this.dispatchs.forEach((dispatch) => {
          dispatch(payload);
        });
        resolve();
      });
    });
  }

  complete() {
    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        this.completes.forEach((complete) => {
          complete();
        });
        resolve();
      });
    });
  }
}

function Timeout(delay = 1000) {
  return new Signal<void>(async (dispatch, complete) => {
    setTimeout(() => {
      dispatch();
      complete();
    }, delay);

    return () => {
    };
  });
}

function Interval(delay = 1000) {
  return new Signal<void>(async (dispatch, complete) => {
    setInterval(() => {
      dispatch();
    }, delay);

    return () => {
      complete();
    };
  });
}

type TerminalRequest = {
  kind: "Log";
  data: string;
} | {
  kind: "Prompt";
  id: string;
  data: string;
};

type TerminalResponse = {
  kind: "Prompt";
  id: string;
  data: string;
};

function Terminal(source: Signal<TerminalRequest>) {
  return new Signal<TerminalResponse>(async (dispatch, complete) => {
    return source.subscribe((payload) => {
      switch (payload.kind) {
        case "Log": {
          console.log(payload.data);
          return;
        }
        case "Prompt": {
          const response = prompt(payload.data) ?? "";
          dispatch({ kind: "Prompt", id: payload.id, data: response });
          return;
        }
      }
    }, complete);
  });
}

function Terminal2(
  cycle: (source: Signal<TerminalResponse>) => Signal<TerminalRequest>,
) {
  return Signal.loop<TerminalResponse>((source) => {
    return Terminal(cycle(source));
  });
}

function byKind<T extends TerminalResponse>(
  kind: T["kind"],
  id: T["id"],
) {
  return (message: T): message is T =>
    message.kind === kind && message.id === id;
}

function ask(response: Signal<TerminalResponse>) {
  return (response: Signal<TerminalResponse>) => {
    response
      .filter(byKind("Prompt", "Question"))
      .map((name): TerminalRequest => ({
        kind: "Log",
        data: "Hello " + name.data,
      }));

    return Signal.of({
      kind: "Prompt",
      data: "What is your name?",
      id: "Question",
    });
  };
}

const main = Signal.loop((source: Signal<TerminalResponse>) => {
  const questionResponse = source
    .filter(byKind("Prompt", "1"))
    .map(({ data }): TerminalRequest => ({
      kind: "Log",
      data: "Hello " + data,
    }));

  const requests = Signal.merge<TerminalRequest>(
    Signal.of({
      kind: "Prompt",
      id: "1",
      data: "Qual o seu nome?",
    }),
    questionResponse,
  );

  const responses = Terminal(requests);

  return responses;
});
await main.subscribe((value) => {
  // console.log("Payload", value);
}, () => {
  console.log("Main completed");
});
