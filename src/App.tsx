import { createSignal, type JSX } from 'solid-js';

function App(): JSX.Element {
  const [count, setCount] = createSignal(0);

  return (
    <div class="flex min-h-screen flex-col items-center justify-center bg-gray-100">
      <h1 class="mb-4 text-3xl font-bold">计数器</h1>
      <div class="mb-8 text-5xl font-bold">{count()}</div>
      <div class="flex gap-4">
        <button
          class="rounded bg-red-500 px-4 py-2 text-white hover:bg-red-600"
          onClick={() => setCount(count() - 1)}
        >
          减少
        </button>
        <button
          class="rounded bg-gray-500 px-4 py-2 text-white hover:bg-gray-600"
          onClick={() => setCount(0)}
        >
          重置
        </button>
        <button
          class="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
          onClick={() => setCount(count() + 1)}
        >
          增加
        </button>
      </div>
    </div>
  );
}

export default App;
