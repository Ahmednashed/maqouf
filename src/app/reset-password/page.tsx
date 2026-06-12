"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Lock, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils/cn";
import { BrandLogo } from "@/components/shared/BrandLogo";

const schema = z
  .object({
    password: z.string().min(8),
    confirm:  z.string().min(8),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type FormData = z.infer<typeof schema>;

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-ink-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-modal border border-ink-200 p-8 animate-pulse">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-full bg-ink-100" />
          </div>
          <div className="h-6 bg-ink-100 rounded-lg mb-3 mx-auto w-40" />
          <div className="h-4 bg-ink-50 rounded-lg mb-6 mx-auto w-56" />
          <div className="space-y-4">
            <div className="h-11 bg-ink-50 rounded-xl" />
            <div className="h-11 bg-ink-50 rounded-xl" />
            <div className="h-11 bg-brand-50 rounded-xl" />
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Form (must be inside Suspense because of useSearchParams) ───────────────

function ResetPasswordForm() {
  const { t, locale } = useTranslation();
  const router        = useRouter();
  const searchParams  = useSearchParams();
  const linkError     = searchParams.get("error");

  const [loading,     setLoading]     = useState(false);
  const [done,        setDone]        = useState(false);
  const [serverError, setServerError] = useState("");

  const isAr = locale === "ar";

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    setServerError("");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: data.password });
    if (error) {
      setServerError(
        isAr
          ? "فشل تحديث كلمة المرور. حاول مجدداً."
          : "Failed to update password. Please try again."
      );
      setLoading(false);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 2500);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-ink-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-modal border border-ink-200 p-8">
          <div className="flex justify-center mb-6">
            <BrandLogo size={48} />
          </div>

          {/* ── Error: expired / already-used link ── */}
          {linkError && (
            <div className="text-center">
              <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
              <h1 className="text-[20px] font-bold text-ink-900">
                {isAr ? "الرابط منتهي الصلاحية" : "Link expired"}
              </h1>
              <p className="mt-2 text-[13px] text-ink-500">
                {isAr
                  ? "انتهت صلاحية رابط إعادة التعيين أو تم استخدامه بالفعل. يرجى طلب رابط جديد."
                  : "Your reset link has expired or was already used. Request a new one."}
              </p>
              <Link
                href="/forgot-password"
                className="mt-5 inline-block px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold transition-all"
              >
                {isAr ? "إرسال رابط جديد" : "Send new link"}
              </Link>
            </div>
          )}

          {/* ── Success ── */}
          {!linkError && done && (
            <div className="text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h1 className="text-[20px] font-bold text-ink-900">
                {isAr ? "تم تحديث كلمة المرور!" : "Password updated!"}
              </h1>
              <p className="mt-2 text-[13px] text-ink-500">
                {isAr
                  ? "سيتم توجيهك إلى صفحة تسجيل الدخول…"
                  : "Redirecting you to login…"}
              </p>
            </div>
          )}

          {/* ── Form ── */}
          {!linkError && !done && (
            <>
              <h1 className="text-[24px] font-bold text-ink-900 text-center tracking-tight">
                {isAr ? "إعادة تعيين كلمة المرور" : "Reset your password"}
              </h1>
              <p className="mt-2 text-[13px] text-ink-500 text-center">
                {isAr
                  ? "أدخل كلمة مرور جديدة لحسابك"
                  : "Enter a new password for your account"}
              </p>

              {serverError && (
                <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-[12.5px] text-rose-700 font-medium">
                  {serverError}
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
                {/* New password */}
                <div>
                  <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                    {isAr ? "كلمة المرور الجديدة" : "New password"}
                  </label>
                  <div className="relative">
                    <Lock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                    <input
                      {...register("password")}
                      type="password"
                      placeholder="••••••••"
                      className={cn(
                        "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all",
                        "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
                        errors.password ? "border-rose-400" : "border-ink-200"
                      )}
                    />
                  </div>
                  {errors.password && (
                    <p className="mt-1 text-[11.5px] text-rose-500">
                      {isAr ? "٨ أحرف على الأقل" : "At least 8 characters required"}
                    </p>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                    {isAr ? "تأكيد كلمة المرور" : "Confirm password"}
                  </label>
                  <div className="relative">
                    <Lock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                    <input
                      {...register("confirm")}
                      type="password"
                      placeholder="••••••••"
                      className={cn(
                        "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all",
                        "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
                        errors.confirm ? "border-rose-400" : "border-ink-200"
                      )}
                    />
                  </div>
                  {errors.confirm && (
                    <p className="mt-1 text-[11.5px] text-rose-500">
                      {isAr ? "كلمتا المرور غير متطابقتين" : "Passwords do not match"}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[14px] font-semibold shadow-pop transition-all"
                >
                  {loading
                    ? t("common.loading")
                    : isAr ? "تحديث كلمة المرور" : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="mt-5 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-900"
          >
            <ArrowLeft className="w-3.5 h-3.5 rtl-flip" />
            {t("auth.backHome")}
          </Link>
        </div>
      </div>
    </main>
  );
}

// ─── Page export ─────────────────────────────────────────────────────────────

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
