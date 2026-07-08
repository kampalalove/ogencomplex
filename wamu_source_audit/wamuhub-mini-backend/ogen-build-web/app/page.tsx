export default function Home() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-20 sm:px-10 lg:px-12">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
            OGEN LAB
          </p>

          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Structure-first systems for creators, businesses, and digital builds.
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600 sm:text-xl">
            We turn complex ideas into clear execution systems, production-ready
            workflows, and scalable digital products built with precision.
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <a
              href="#services"
              className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              View Services
            </a>

            <a
              href="#about"
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100"
            >
              Learn More
            </a>
          </div>
        </div>
      </section>

      <section
        id="services"
        className="border-t border-zinc-200 bg-zinc-50 px-6 py-20 sm:px-10 lg:px-12"
      >
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Services
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              What OGEN Lab builds
            </h2>
            <p className="mt-4 text-lg leading-8 text-zinc-600">
              Focused systems designed to reduce friction, increase clarity, and
              move real work into production.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h3 className="text-xl font-semibold">Web Systems</h3>
              <p className="mt-3 leading-7 text-zinc-600">
                Clean, modern websites and internal platforms built for speed,
                clarity, and long-term maintainability.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h3 className="text-xl font-semibold">Workflow Design</h3>
              <p className="mt-3 leading-7 text-zinc-600">
                Operational flows, automation structure, and process design that
                turn scattered ideas into usable systems.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h3 className="text-xl font-semibold">Build Strategy</h3>
              <p className="mt-3 leading-7 text-zinc-600">
                Execution plans that prioritize proof, clean architecture, and
                production-ready outcomes over noise.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="px-6 py-20 sm:px-10 lg:px-12">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
              About
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Built around execution, not clutter
            </h2>
          </div>

          <div className="text-lg leading-8 text-zinc-600">
            <p>
              OGEN Lab is built around one principle: create structure that helps
              real work move forward. That means fewer dead ends, fewer broken
              loops, and stronger systems that can actually be used.
            </p>
            <p className="mt-6">
              From digital products to service workflows, the goal is the same:
              turn complexity into something clean, usable, and ready to ship.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}