
"use client";

import { useEffect, useState } from "react";

type Language = "ar" | "en";

type Content = {
  dir: "rtl" | "ltr";
  nav: {
    features: string;
    howItWorks: string;
    pricing: string;
    contact: string;
  };
  cta: string;
  heroTitle: string;
  heroSubtitle: string;
  problem: string;
  featuresLabel: string;
  features: string[];
  howLabel: string;
  howSteps: string[];
  pricingLabel: string;
  pricingPoints: string[];
  finalCta: string;
  footer: {
    privacy: string;
    terms: string;
    contact: string;
  };
  dashboard: {
    visits: string;
    team: string;
    completion: string;
    liveStatus: string;
    taskTitle: string;
    taskBody: string;
  };
  mobile: {
    title: string;
    visit: string;
    branch: string;
    button: string;
  };
};

const content: Record<Language, Content> = {
  ar: {
    dir: "rtl",
    nav: {
      features: "المميزات",
      howItWorks: "كيف يعمل",
      pricing: "الأسعار",
      contact: "تواصل معنا",
    },
    cta: "ابدأ تجربتك المجانية",
    heroTitle: "ملقوف — إدارة فرق الميدان بسهولة",
    heroSubtitle:
      "تابع زيارات فريقك، راقب الأداء، وتأكد أن كل زيارة تمت كما يجب — من مكان واحد.",
    problem:
      "متابعة فرق الميدان صعبة؟ ملقوف يعطيك رؤية مباشرة لكل زيارة وتحكم كامل بالفريق.",
    featuresLabel: "مميزات أساسية",
    features: [
      "تتبع الزيارات",
      "إدارة الفريق",
      "فورمات مخصصة",
      "رفع الصور",
      "تقارير مباشرة",
    ],
    howLabel: "كيف يعمل",
    howSteps: [
      "أضف الفروع والمنتجات",
      "عيّن الزيارات لفريقك",
      "تابع التنفيذ لحظة بلحظة",
    ],
    pricingLabel: "الأسعار",
    pricingPoints: ["تجربة مجانية 14 يوم", "اشتراك شهري حسب عدد المستخدمين"],
    finalCta: "ابدأ الآن وخلّي كل زيارة محسوبة",
    footer: {
      privacy: "سياسة الخصوصية",
      terms: "الشروط",
      contact: "تواصل",
    },
    dashboard: {
      visits: "الزيارات اليوم",
      team: "الفريق النشط",
      completion: "نسبة الإنجاز",
      liveStatus: "تنفيذ مباشر",
      taskTitle: "زيارة فرع العليا",
      taskBody: "تم الوصول، رفع الصور، وإرسال التقرير بنجاح.",
    },
    mobile: {
      title: "تطبيق الفريق",
      visit: "الزيارة القادمة",
      branch: "فرع النخيل - 3:30 م",
      button: "ابدأ الزيارة",
    },
  },
  en: {
    dir: "ltr",
    nav: {
      features: "Features",
      howItWorks: "How it works",
      pricing: "Pricing",
      contact: "Contact",
    },
    cta: "Start Free Trial",
    heroTitle: "Malgoof — Field Team Management Made Simple",
    heroSubtitle:
      "Track field visits, monitor performance, and make sure every visit is completed correctly — all from one place.",
    problem:
      "Managing field teams is difficult. Malgoof gives you real-time visibility over every visit and full control of your team.",
    featuresLabel: "Core Features",
    features: [
      "Visit Tracking",
      "Team Management",
      "Custom Forms",
      "Photo Uploads",
      "Live Reports",
    ],
    howLabel: "How It Works",
    howSteps: [
      "Add branches and products",
      "Assign visits to your team",
      "Track execution in real time",
    ],
    pricingLabel: "Pricing",
    pricingPoints: [
      "14-day free trial",
      "Monthly subscription based on number of users",
    ],
    finalCta: "Start now and make every visit count",
    footer: {
      privacy: "Privacy Policy",
      terms: "Terms",
      contact: "Contact",
    },
    dashboard: {
      visits: "Visits Today",
      team: "Active Team",
      completion: "Completion",
      liveStatus: "Live Execution",
      taskTitle: "Olaya Branch Visit",
      taskBody: "Arrived on-site, uploaded photos, and submitted the report.",
    },
    mobile: {
      title: "Field App",
      visit: "Next Visit",
      branch: "Nakheel Branch - 3:30 PM",
      button: "Start Visit",
    },
  },
};

const featureIcons = ["01", "02", "03", "04", "05"];

export default function Home() {
  const [language, setLanguage] = useState<Language>("ar");
  const active = content[language];

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = active.dir;
  }, [active.dir, language]);

  const isArabic = language === "ar";
  const alignClass = isArabic ? "text-right" : "text-left";
  const rowClass = isArabic ? "flex-row-reverse" : "flex-row";

  return (
    <main className="overflow-hidden text-ink">
      <header className="section-shell sticky top-0 z-30 pt-6">
        <div className="glass-card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className={`flex items-center gap-3 ${rowClass}`}>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-sm font-bold text-white">
              م
            </div>
            <div className={alignClass}>
              <div className="text-lg font-semibold text-ink">ملقوف / Malgoof</div>
              <div className="text-sm text-slate-500">
                {isArabic ? "إدارة فرق الميدان" : "Field Team Management"}
              </div>
            </div>
          </div>

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 lg:flex">
            <a href="#features" className="transition hover:text-brand">
              {active.nav.features}
            </a>
            <a href="#how-it-works" className="transition hover:text-brand">
              {active.nav.howItWorks}
            </a>
            <a href="#pricing" className="transition hover:text-brand">
              {active.nav.pricing}
            </a>
            <a href="#contact" className="transition hover:text-brand">
              {active.nav.contact}
            </a>
          </nav>

          <div className={`flex items-center gap-3 ${rowClass}`}>
            <button
              type="button"
              onClick={() => setLanguage(isArabic ? "en" : "ar")}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand hover:text-brand"
            >
              {isArabic ? "English" : "عربي"}
            </button>
            <a
              href="#contact"
              className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600"
            >
              {active.cta}
            </a>
          </div>
        </div>
      </header>

      <section className="section-shell relative py-16 sm:py-20">
        <div className="absolute inset-x-0 top-10 -z-10 h-72 bg-hero-grid bg-[length:36px_36px] opacity-50" />
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className={alignClass}>
            <span className="section-label fade-in">
              {isArabic ? "منصة تشغيل فرق الميدان" : "Field operations platform"}
            </span>
            <h1 className="fade-in mt-6 max-w-3xl text-4xl font-semibold leading-tight text-ink sm:text-5xl lg:text-6xl">
              {active.heroTitle}
            </h1>
            <p className="fade-in-delay mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
              {active.heroSubtitle}
            </p>
            <div className={`fade-in-delay-2 mt-8 flex flex-wrap gap-4 ${rowClass}`}>
              <a
                href="#pricing"
                className="rounded-full bg-brand px-6 py-3 text-base font-semibold text-white transition hover:bg-red-600"
              >
                {active.cta}
              </a>
              <a
                href="#features"
                className="rounded-full border border-slate-300 px-6 py-3 text-base font-semibold text-slate-700 transition hover:border-ink hover:text-ink"
              >
                {active.nav.features}
              </a>
            </div>
            <p className="mt-10 max-w-2xl text-base leading-7 text-slate-500">
              {active.problem}
            </p>
          </div>

          <div className="relative">
            <div className="glass-card mockup-grid relative overflow-hidden rounded-[32px] p-5 sm:p-7">
              <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brand/10 to-transparent" />
              <div className={`relative flex items-start justify-between gap-4 ${rowClass}`}>
                <div className={alignClass}>
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-brand/80">
                    Dashboard
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-ink">
                    {active.dashboard.liveStatus}
                  </h2>
                </div>
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-600">
                  {isArabic ? "متصل الآن" : "Live now"}
                </div>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {[
                  ["184", active.dashboard.visits],
                  ["27", active.dashboard.team],
                  ["96%", active.dashboard.completion],
                ].map(([value, label]) => (
                  <div key={label} className={`rounded-2xl border border-white bg-white/90 p-4 ${alignClass}`}>
                    <div className="text-2xl font-semibold text-ink">{value}</div>
                    <div className="mt-2 text-sm text-slate-500">{label}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className={`rounded-[28px] bg-ink p-6 text-white ${alignClass}`}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-white/70">
                      {isArabic ? "أحدث تنفيذ" : "Latest activity"}
                    </span>
                    <span className="h-3 w-3 rounded-full bg-brand" />
                  </div>
                  <h3 className="mt-6 text-xl font-semibold">{active.dashboard.taskTitle}</h3>
                  <p className="mt-3 text-sm leading-7 text-white/75">
                    {active.dashboard.taskBody}
                  </p>
                  <div className="mt-8 grid gap-3 sm:grid-cols-3">
                    {[
                      isArabic ? "صورة" : "Photo",
                      isArabic ? "فورم" : "Form",
                      isArabic ? "موقع" : "Location",
                    ].map((tag) => (
                      <div
                        key={tag}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm"
                      >
                        {tag}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mx-auto w-full max-w-[280px] rounded-[34px] border border-slate-200 bg-white p-3 shadow-soft">
                  <div className="rounded-[28px] bg-slate-950 p-4 text-white">
                    <div className="mb-4 h-1.5 w-20 rounded-full bg-white/20 mx-auto" />
                    <div className={`rounded-[24px] bg-white/5 p-4 ${alignClass}`}>
                      <div className="text-sm text-white/60">{active.mobile.title}</div>
                      <div className="mt-5 rounded-3xl bg-white px-4 py-5 text-ink">
                        <div className="text-sm text-slate-500">{active.mobile.visit}</div>
                        <div className="mt-2 text-lg font-semibold">{active.mobile.branch}</div>
                        <div className="mt-5 space-y-3">
                          <div className="h-3 rounded-full bg-slate-100" />
                          <div className="h-3 w-4/5 rounded-full bg-slate-100" />
                          <div className="h-3 w-3/5 rounded-full bg-slate-100" />
                        </div>
                        <button
                          type="button"
                          className="mt-6 w-full rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white"
                        >
                          {active.mobile.button}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="section-shell py-10 sm:py-14">
        <div className={`flex items-end justify-between gap-6 ${rowClass}`}>
          <div className={alignClass}>
            <span className="section-label">{active.featuresLabel}</span>
            <h2 className="mt-4 text-3xl font-semibold text-ink sm:text-4xl">
              {isArabic ? "كل ما يحتاجه فريقك في مكان واحد" : "Everything your team needs in one place"}
            </h2>
          </div>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {active.features.map((feature, index) => (
            <article key={feature} className={`feature-card ${alignClass}`}>
              <div className="text-sm font-semibold text-brand">{featureIcons[index]}</div>
              <h3 className="mt-5 text-xl font-semibold text-ink">{feature}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                {isArabic
                  ? "واجهة بسيطة تساعد الفريق على التنفيذ السريع مع توثيق كامل لكل خطوة."
                  : "A focused workflow that keeps execution fast while documenting every step clearly."}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="section-shell py-10 sm:py-14">
        <div className="glass-card overflow-hidden p-8 sm:p-10">
          <div className={`grid gap-10 lg:grid-cols-[0.9fr_1.1fr] ${isArabic ? "lg:[direction:rtl]" : ""}`}>
            <div className={alignClass}>
              <span className="section-label">{active.howLabel}</span>
              <h2 className="mt-4 text-3xl font-semibold text-ink sm:text-4xl">
                {isArabic ? "خطوات قليلة، وضوح كامل" : "A simple flow, full visibility"}
              </h2>
              <p className="mt-4 text-base leading-8 text-slate-600">
                {isArabic
                  ? "من إعداد البيانات إلى متابعة التنفيذ، ملقوف يحول العمل الميداني إلى عملية واضحة وسهلة القياس."
                  : "From setup to execution, Malgoof turns field operations into a workflow that is easy to track and improve."}
              </p>
            </div>

            <div className="grid gap-4">
              {active.howSteps.map((step, index) => (
                <div
                  key={step}
                  className={`flex items-start gap-4 rounded-3xl border border-slate-200 bg-mist p-5 ${rowClass}`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-lg font-semibold text-white">
                    {index + 1}
                  </div>
                  <div className={alignClass}>
                    <h3 className="text-lg font-semibold text-ink">{step}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-500">
                      {isArabic
                        ? "تنفيذ مرتب وواضح يساعد الإدارة على اتخاذ قرارات أسرع."
                        : "A clear operating step that helps leadership act faster with better context."}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="section-shell py-10 sm:py-14">
        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className={`glass-card p-8 sm:p-10 ${alignClass}`}>
            <span className="section-label">{active.pricingLabel}</span>
            <h2 className="mt-4 text-3xl font-semibold text-ink sm:text-4xl">
              {isArabic ? "تسعير واضح يناسب النمو" : "Simple pricing that scales with you"}
            </h2>
            <div className="mt-8 space-y-4">
              {active.pricingPoints.map((point) => (
                <div
                  key={point}
                  className={`flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-4 ${rowClass}`}
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-brand" />
                  <span className="text-base text-slate-700">{point}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-8 sm:p-10">
            <div className={`flex items-start justify-between gap-4 ${rowClass}`}>
              <div className={alignClass}>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-brand/80">
                  Premium
                </p>
                <h3 className="mt-3 text-3xl font-semibold text-ink">
                  {isArabic ? "ابدأ بسرعة" : "Launch quickly"}
                </h3>
              </div>
              <div className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white">
                {isArabic ? "بدون تعقيد" : "No complexity"}
              </div>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {[
                isArabic ? "إعداد مرن للفروع" : "Flexible branch setup",
                isArabic ? "تقارير مباشرة" : "Live reporting",
                isArabic ? "سهولة للفريق" : "Easy for teams",
                isArabic ? "لوحة متابعة واضحة" : "Clear dashboard",
              ].map((item) => (
                <div key={item} className={`rounded-3xl bg-mist p-5 ${alignClass}`}>
                  <div className="text-sm font-semibold text-brand">
                    {isArabic ? "ميزة" : "Benefit"}
                  </div>
                  <div className="mt-3 text-lg font-semibold text-ink">{item}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="contact" className="section-shell py-14 sm:py-20">
        <div className="glass-card overflow-hidden rounded-[36px] bg-ink px-8 py-10 text-white sm:px-12 sm:py-14">
          <div className="absolute" />
          <div className={`grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] ${isArabic ? "lg:[direction:rtl]" : ""}`}>
            <div className={alignClass}>
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80">
                {isArabic ? "جاهز للانطلاق" : "Ready to start"}
              </span>
              <h2 className="mt-5 text-3xl font-semibold sm:text-5xl">{active.finalCta}</h2>
              <p className="mt-4 max-w-2xl text-base leading-8 text-white/70">
                {isArabic
                  ? "نظام واحد لإدارة الزيارات، قياس الأداء، وربط الفريق بالميدان لحظة بلحظة."
                  : "One focused system for visits, reporting, and real-time visibility across your field team."}
              </p>
            </div>

            <form className="grid gap-4 rounded-[32px] bg-white p-5 text-ink sm:p-6">
              <input
                type="text"
                placeholder={isArabic ? "اسم الشركة" : "Company name"}
                className={`rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-brand ${alignClass}`}
              />
              <input
                type="email"
                placeholder={isArabic ? "البريد الإلكتروني" : "Email address"}
                className={`rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-brand ${alignClass}`}
              />
              <button
                type="button"
                className="rounded-full bg-brand px-5 py-3 text-base font-semibold text-white transition hover:bg-red-600"
              >
                {active.cta}
              </button>
            </form>
          </div>
        </div>
      </section>

      <footer className="section-shell pb-8">
        <div className={`flex flex-col gap-4 border-t border-slate-200 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between ${isArabic ? "sm:flex-row-reverse" : ""}`}>
          <div>ملقوف / Malgoof</div>
          <div className={`flex gap-6 ${isArabic ? "flex-row-reverse" : ""}`}>
            <a href="#" className="transition hover:text-brand">
              {active.footer.privacy}
            </a>
            <a href="#" className="transition hover:text-brand">
              {active.footer.terms}
            </a>
            <a href="#contact" className="transition hover:text-brand">
              {active.footer.contact}
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
