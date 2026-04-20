"use client";

import { useRef, useTransition } from "react";
import { askFollowupAction } from "@/app/dashboard/analyze/[ticker]/actions";

export default function FollowupChat({ ticker }: { ticker: string }) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await askFollowupAction(ticker, formData);
      formRef.current?.reset();
    });
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="rounded-lg border border-navy-200 bg-navy-50/60 p-4"
    >
      <label
        htmlFor="question"
        className="mb-2 block text-sm font-medium text-navy-800"
      >
        ¿Tienes alguna duda más sobre el negocio?
      </label>
      <div className="flex gap-2">
        <input
          id="question"
          name="question"
          type="text"
          minLength={3}
          required
          disabled={isPending}
          placeholder="Ej: ¿Qué pasa si las tasas suben 200bp?"
          className="flex-1 rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {isPending ? "Pensando..." : "Preguntar"}
        </button>
      </div>
      <p className="mt-2 text-xs text-navy-500">
        Tu pregunta y la respuesta se guardan con esta versión de la spec para
        que puedas revisarlas en el futuro.
      </p>
    </form>
  );
}
