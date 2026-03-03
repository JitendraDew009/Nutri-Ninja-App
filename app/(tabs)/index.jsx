import React, { useEffect, useRef, useState } from "react";

/*
  NutriScan - Single-file app component
  - Barcode scanning (BarcodeDetector) with manual lookup fallback
  - Open Food Facts lookup + caching
  - Nutri-Score gauge with animated needle
  - Macro bar chart + radar chart
  - Health score, traffic lights, additives, warnings, clean-scan
  Defensive: tolerates missing fields and missing APIs.
*/

const safeNum = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const NUTRI_COLORS = { a: "#1FA260", b: "#85C742", c: "#F7D622", d: "#E98E2C", e: "#D72020" };
const CACHE_KEY = "off_product_cache_v1";

// Traffic light small UI
function TrafficLight({ label, value, thresholds }) {
  if (value == null) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <strong>{label}:</strong>
      <span style={{ color: "#888" }}>—</span>
    </div>
  );
  let color = "#4CAF50";
  if (value > thresholds.high) color = "#E53935";
  else if (value > thresholds.medium) color = "#FBC02D";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <strong>{label}:</strong>
      <span style={{ padding: "4px 8px", borderRadius: 6, background: color, color: "#fff" }}>{value}</span>
    </div>
  );
}

// Additives list (simple risk bucketing)
function AdditivesList({ additives = [] }) {
  if (!additives || additives.length === 0) return <p style={{ color: "#666", margin: 0 }}>No additives listed</p>;
  const riskOf = (code) => {
    const c = (code || "").toLowerCase();
    const match = c.match(/e(\d{2,3})/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num)) {
        if (num >= 100 && num < 200) return "High";
        if (num >= 200 && num < 400) return "Moderate";
        return "Low";
      }
    }
    if (c.includes("color") || c.includes("tartrazine") || c.includes("allura")) return "High";
    if (c.includes("benzo") || c.includes("preserv")) return "Moderate";
    return "Low";
  };

  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {additives.map((a) => (
        <li key={a} style={{ marginBottom: 6 }}>
          <strong>{a}</strong> — {riskOf(a)}
        </li>
      ))}
    </ul>
  );
}

// Health score (1-100) — simple weighted heuristic
function getHealthScore(product) {
  if (!product || !product.nutriments) return 50;
  const n = product.nutriments;
  let score = 100;
  score -= (n.sugars_100g || n.sugars || 0) * 1.8;
  score -= (n["saturated-fat_100g"] || n["saturated-fat"] || n.saturated_fat || 0) * 2.2;
  score -= (n.salt_100g || n.salt || 0) * 1.5;
  const additives = product.additives_tags || product.additives || [];
  const highRiskAdd = additives.filter((a) => /e10|e1|e102|e129/i.test(a)).length;
  score -= highRiskAdd * 6;
  score += (n.fiber_100g || n.fiber || 0) * 1.5;
  score += (n.proteins_100g || n.proteins || n.protein || 0) * 1.2;
  return Math.round(Math.max(1, Math.min(100, score)));
}

// Smart warnings
function getSmartWarnings(p) {
  if (!p) return [];
  const warnings = [];
  const n = p.nutriments || {};
  if ((n.sugars_100g || n.sugars || 0) > 22.5) warnings.push("High sugar content");
  if ((n["saturated-fat_100g"] || n.saturated_fat || 0) > 5) warnings.push("High saturated fat");
  if ((n.salt_100g || n.salt || 0) > 1.5) warnings.push("High salt content");
  const allergensText = (p.allergens || "").toLowerCase();
  const commonAllergens = ["milk", "soy", "egg", "peanut", "tree nut", "sesame", "fish", "shellfish", "gluten", "wheat", "mustard", "sulphite"];
  const foundAll = commonAllergens.filter((a) => allergensText.includes(a) || (p.allergens_tags || []).some((tag) => tag.includes(a.replace(/ /g, "-"))));
  if (foundAll.length) warnings.push(`Contains allergens: ${foundAll.join(", ")}`);
  const additives = p.additives_tags || [];
  const suspicious = additives.filter((a) => /e102|e110|e129|e211|e621/i.test(a));
  if (suspicious.length) warnings.push(`Contains suspicious additives: ${suspicious.join(", ")}`);
  return warnings;
}

// Clean ingredient scan
function scanIngredientsForIssues(text) {
  if (!text) return { clean: true, found: [] };
  const keywords = ["color", "colour", "tartrazine", "allura", "sunset yellow", "preservative", "benzo", "sorbate", "msg", "monosodium glutamate", "e621", "e951", "ace-k", "sucralose", "palm"];
  const found = keywords.filter((k) => text.toLowerCase().includes(k));
  return { clean: found.length === 0, found };
}

// Macro bar chart (SVG)
function MacroBarChart({ nutriments = {} }) {
  const bars = [
    { key: "fat", label: "Fat (g)" },
    { key: "saturated-fat", label: "Sat Fat (g)" },
    { key: "carbohydrates", label: "Carbs (g)" },
    { key: "sugars", label: "Sugars (g)" },
    { key: "proteins", label: "Protein (g)" },
    { key: "fiber", label: "Fiber (g)" },
    { key: "salt", label: "Salt (g)" },
  ];
  const values = bars.map((b) => nutriments[b.key + "_100g"] ?? nutriments[b.key] ?? 0);
  const maxVal = Math.max(...values, 10);
  return (
    <svg width="100%" height={40 + bars.length * 28}>
      {bars.map((b, i) => {
        const v = values[i] || 0;
        const pct = Math.min(1, v / (maxVal || 1));
        const x = 120;
        const y = 20 + i * 28;
        return (
          <g key={b.key}>
            <text x={8} y={y + 6} fontSize={12} fill="#333">
              {b.label}
            </text>
            <rect x={x} y={y - 10} width={200} height={16} rx={8} fill="#eee" />
            <rect x={x} y={y - 10} width={200 * pct} height={16} rx={8} fill="#5B8DEF" />
            <text x={x + 210} y={y + 6} fontSize={12} fill="#333">
              {v ?? "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Radar chart
function RadarChart({ nutriments = {} }) {
  const axes = [
    { key: "energy-kcal", label: "Energy" },
    { key: "fat", label: "Fat" },
    { key: "sugars", label: "Sugar" },
    { key: "proteins", label: "Protein" },
    { key: "fiber", label: "Fiber" },
  ];
  const caps = { "energy-kcal": 600, fat: 50, sugars: 60, proteins: 50, fiber: 20 };
  const w = 220,
    h = 220,
    cx = w / 2,
    cy = h / 2,
    r = 80;
  const points = axes.map((a, i) => {
    const key = a.key;
    const raw = nutriments[key + "_100g"] ?? nutriments[key] ?? 0;
    const norm = Math.min(1, raw / (caps[key] || 1));
    const angle = Math.PI * 2 * (i / axes.length) - Math.PI / 2;
    return [cx + Math.cos(angle) * r * norm, cy + Math.sin(angle) * r * norm];
  });
  const poly = points.map((p) => p.join(",")).join(" ");
  return (
    <svg width={w} height={h}>
      {[1, 0.75, 0.5, 0.25].map((f, i) => (
        <polygon
          key={i}
          points={Array.from({ length: axes.length })
            .map((_, j) => {
              const angle = Math.PI * 2 * (j / axes.length) - Math.PI / 2;
              const rr = r * f;
              return `${cx + Math.cos(angle) * rr},${cy + Math.sin(angle) * rr}`;
            })
            .join(" ")}
          fill="none"
          stroke="#eee"
        />
      ))}
      {axes.map((a, i) => {
        const angle = Math.PI * 2 * (i / axes.length) - Math.PI / 2;
        const tx = cx + Math.cos(angle) * (r + 18);
        const ty = cy + Math.sin(angle) * (r + 18);
        return (
          <text key={a.key} x={tx} y={ty} fontSize={11} textAnchor="middle" fill="#333">
            {a.label}
          </text>
        );
      })}
      <polygon points={poly} fill="#5B8DEF55" stroke="#5B8DEF" strokeWidth={2} />
    </svg>
  );
}

// ------------ Main App ------------
export default function App() {
  const videoRef = useRef(null);
  const scanningRef = useRef(false);
  const [status, setStatus] = useState("Idle — press Start Camera");
  const [product, setProduct] = useState(null);
  const [manual, setManual] = useState("");
  const [needleRotation, setNeedleRotation] = useState(-60);
  const [cacheHits, setCacheHits] = useState(0);

  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera start/stop
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Camera not supported in this browser. Use manual lookup.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) videoRef.current.srcObject = stream;
      scanningRef.current = true;
      setStatus("Camera active — point at barcode");
      if ("BarcodeDetector" in window) runDetector();
      else setStatus("BarcodeDetector not available — use manual lookup.");
    } catch (err) {
      console.error("Camera error:", err);
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        setStatus("Camera permission denied — allow camera and retry");
      } else if (err && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
        setStatus("No suitable camera found. Try a different device.");
      } else {
        setStatus("Camera error — try manual lookup");
      }
    }
  }

  function stopCamera() {
    scanningRef.current = false;
    const stream = videoRef.current?.srcObject;
    if (stream && stream.getTracks) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        console.warn(e);
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    }
    setStatus("Camera stopped");
  }

  // barcode detector loop
  async function runDetector() {
    if (!videoRef.current) return;
    if (!("BarcodeDetector" in window)) {
      setStatus("BarcodeDetector not available — use manual lookup");
      return;
    }
    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "code_128", "code_39"] });
    } catch (e) {
      console.warn("Detector init failed", e);
      setStatus("BarcodeDetector init failed — use manual lookup");
      return;
    }

    async function loop() {
      if (!scanningRef.current) return;
      try {
        const results = await detector.detect(videoRef.current);
        if (results && results.length) {
          const code = results[0]?.rawValue || results[0]?.rawText;
          if (code) await onDetected(code);
        }
      } catch (e) {
        // ignore transient detection errors
      }
      if (scanningRef.current) requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
  }

  // cache helpers
  function getCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function addToCache(code, p) {
    try {
      const c = getCache();
      c[code] = p;
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) {
      console.warn(e);
    }
  }

  // normalize OFF product
  function normalizeProduct(raw) {
    const nutr = raw.nutriments || {};
    return {
      code: raw.code,
      product_name: raw.product_name || raw.generic_name || "",
      brands: raw.brands || "",
      image: raw.image_small_url || raw.image_front_small_url || raw.image_url || null,
      nutriments: {
        "energy-kcal_100g": safeNum(nutr["energy-kcal_100g"] || nutr["energy-kcal"] || nutr.energy_kcal || nutr.energy),
        "fat_100g": safeNum(nutr["fat_100g"] || nutr.fat),
        "saturated-fat_100g": safeNum(nutr["saturated-fat_100g"] || nutr["saturated-fat"] || nutr.saturated_fat),
        "carbohydrates_100g": safeNum(nutr["carbohydrates_100g"] || nutr.carbohydrates),
        "sugars_100g": safeNum(nutr["sugars_100g"] || nutr.sugars),
        "fiber_100g": safeNum(nutr["fiber_100g"] || nutr.fiber),
        "proteins_100g": safeNum(nutr["proteins_100g"] || nutr.proteins || nutr.protein),
        "salt_100g": safeNum(nutr["salt_100g"] || nutr.salt),
        "sodium_100g": safeNum(nutr["sodium_100g"] || nutr.sodium),
        sugars: safeNum(nutr.sugars),
        fat: safeNum(nutr.fat),
        proteins: safeNum(nutr.proteins || nutr.protein),
        fiber: safeNum(nutr.fiber),
        salt: safeNum(nutr.salt),
        "saturated-fat": safeNum(nutr["saturated-fat"] || nutr.saturated_fat),
      },
      nutrition_grade: raw.nutrition_grade_fr || raw.nutrition_grade || null,
      ingredients_text: raw.ingredients_text || raw.ingredients_text_en || "",
      additives_tags: raw.additives_tags || [],
      additives: raw.additives || raw.additives_original_text || [],
      allergens: raw.allergens || (raw.allergens_tags ? raw.allergens_tags.join(", ") : "") || "",
      ingredients_analysis_tags: raw.ingredients_analysis_tags || [],
      quantity: raw.quantity || "",
    };
  }

  async function onDetected(code) {
    if (!code) return;
    setStatus(`Detected ${code} — fetching...`);
    const cache = getCache();
    if (cache[code]) {
      setProduct(cache[code]);
      setCacheHits((h) => h + 1);
      setStatus("Loaded from cache");
      updateNeedle(cache[code]);
      return;
    }
    try {
      const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data && data.status === 1) {
        const p = normalizeProduct(data.product);
        setProduct(p);
        addToCache(code, p);
        setStatus("Product loaded");
        updateNeedle(p);
      } else {
        setProduct({ not_found: true, code });
        setStatus("Product not found in Open Food Facts");
      }
    } catch (e) {
      console.error(e);
      setStatus("Network error during product lookup");
    }
  }

  function updateNeedle(p) {
    const grade = (p?.nutrition_grade || "c").toString().toLowerCase();
    const mapping = { a: -60, b: -30, c: 0, d: 30, e: 60 };
    const rot = mapping[grade] ?? 0;
    setNeedleRotation(rot);
  }

  // derived
  const healthScore = getHealthScore(product || {});
  const warnings = getSmartWarnings(product || {});
  const cleanScan = scanIngredientsForIssues(product?.ingredients_text || "");

  // smaller, safer render tree (avoids heavy DOM when product not present)
  return (
    <div
  style={{
    fontFamily: "Inter, system-ui, -apple-system",
    padding: 20,
    maxWidth: 9800,
    margin: "AUTO",
    minHeight: "100vh",
    overflowY: "auto"
  }}
>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: "#FFF" }}>Nutri Ninja</h1>
        <div style={{ fontSize: 10, color: "#FFFF" }}>Cache hits: {cacheHits}</div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 18 }}>
        <main style={{ minWidth: 0 }}>
          <section style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button onClick={startCamera} style={{ padding: "10px 14px", borderRadius: 8 }}>
                Start Camera
              </button>
              <button onClick={stopCamera} style={{ padding: "10px 14px", borderRadius: 8 }}>
                Stop Camera
              </button>
              <input
                placeholder="Enter barcode manually"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #e6e6e6" }}
              />
              <button onClick={() => onDetected(manual)} style={{ padding: "10px 14px", borderRadius: 8 }}>
                Lookup
              </button>
            </div>

            <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000" }}>
              <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", display: "block" }} />
              <div style={{ position: "absolute", top: 12, left: 12, background: "rgba(255,255,255,0.95)", padding: "6px 10px", borderRadius: 8 }}>
                {status}
              </div>
            </div>
          </section>

          {product && !product.not_found && (
            <section style={{ marginTop: 16 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ flex: 1, background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 6px 20px rgba(8,12,20,0.04)" }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div>
                      {product.image ? (
                        <img src={product.image} alt="" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 12 }} />
                      ) : (
                        <div style={{ width: 120, height: 120, borderRadius: 12, background: "#f3f3f3" }} />
                      )}
                    </div>

                    <div style={{ flex: 1 }}>
                      <h2 style={{ margin: 0 }}>{product.product_name}</h2>
                      <div style={{ color: "#666", marginTop: 6 }}>
                        {product.brands} • {product.quantity}
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                        <div
                          style={{
                            padding: "6px 10px",
                            borderRadius: 8,
                            background: healthScore >= 60 ? "#1FA260" : healthScore >= 35 ? "#F7D622" : "#D72020",
                            color: "#fff",
                            fontWeight: 700,
                          }}
                        >
                          {healthScore}
                        </div>
                        <div style={{ color: "#666", fontSize: 13 }}>Health score (1-100)</div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <strong>Nutrition (per 100g/ml)</strong>
                        <div style={{ marginTop: 8 }}>
                          <MacroBarChart nutriments={product.nutriments} />
                        </div>

                        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
                          <TrafficLight label="Sugar (g)" value={product.nutriments?.["sugars_100g"] ?? product.nutriments?.sugars} thresholds={{ medium: 5, high: 22.5 }} />
                          <TrafficLight label="Salt (g)" value={product.nutriments?.["salt_100g"] ?? product.nutriments?.salt} thresholds={{ medium: 0.3, high: 1.5 }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <strong>Ingredients</strong>
                    <p style={{ color: "#444" }}>{product.ingredients_text || "—"}</p>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <strong>Additives</strong>
                    <AdditivesList additives={product.additives || product.additives_tags || []} />
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <strong>Smart Warnings</strong>
                    {warnings.length ? <ul>{warnings.map((w, i) => (<li key={i}>⚠️ {w}</li>))}</ul> : <p style={{ margin: 0 }}>No warnings</p>}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <strong>Clean Ingredients Scan</strong>
                    {cleanScan.clean ? <p style={{ margin: 0 }}>✔️ No obvious artificial ingredients found</p> : <p style={{ margin: 0 }}>⚠️ Found: {cleanScan.found.join(", ")}</p>}
                  </div>
                </div>

                <aside style={{ width: 360 }}>
                  <div style={{ background: "#fff", borderRadius: 12, padding: 14, boxShadow: "0 6px 20px rgba(8,12,20,0.04)" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontWeight: 700 }}>Nutri-Score</div>
                      <div style={{ position: "relative", width: 220, height: 120, margin: "12px auto 0" }}>
                        <svg width="220" height="120">
                          {["a", "b", "c", "d", "e"].map((g) => (
                            <path key={g} d="M20 100 A90 90 0 0 1 200 100" stroke={NUTRI_COLORS[g]} strokeWidth={18} fill="none" opacity={0.35} />
                          ))}
                        </svg>

                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            bottom: 2,
                            width: 4,
                            height: 70,
                            background: "#222",
                            transformOrigin: "bottom center",
                            transform: `translateX(-50%) rotate(${needleRotation}deg)`,
                            transition: "transform 650ms cubic-bezier(.2,.9,.3,1)",
                          }}
                        />
                      </div>

                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 700 }}>{product.nutrition_grade ? product.nutrition_grade.toUpperCase() : "—"}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <RadarChart nutriments={product.nutriments} />
                    </div>
                  </div>
                </aside>
              </div>
            </section>
          )}

          {product && product.not_found && (
            <div style={{ marginTop: 16, background: "#fff", padding: 16, borderRadius: 12 }}>
              <strong>Product not found</strong>
              <p>Try manual entry or add the product to Open Food Facts.</p>
            </div>
          )}
        </main>

        <aside style={{ minWidth: 0 }}>
          <div style={{ background: "#fff", padding: 14, borderRadius: 12, boxShadow: "0 6px 20px rgba(8,12,20,0.04)" }}>
            <h3 style={{ marginTop: 0 }}>Quick Actions</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => {
                  localStorage.removeItem(CACHE_KEY);
                  setCacheHits(0);
                  setStatus("Cache cleared");
                }}
                style={{ padding: 10, borderRadius: 8 }}
              >
                Clear cache
              </button>
              <a style={{ padding: 10, borderRadius: 8, background: "#eef", textAlign: "center", textDecoration: "none", display: "block" }} href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">
                OpenFoodFacts.org
              </a>
            </div>

            <div style={{ marginTop: 12 }}>
              <small style={{ color: "#666" }}>Tip: For best results use rear camera in good light and stable framing of barcode.</small>
            </div>
          </div>
        </aside>
      </div>

      <footer style={{ marginTop: 22, marginBottom: 50, textAlign: "center", fontSize: 20, color: "#666" }}>Built with Open Food Facts • This is a prototype to verify nutrition labels for clinical use.</footer>
      <footer style={{ marginTop: 0, marginBottom: 100, textAlign: "center", fontSize: 20, color: "#666" }}> Nutri Ninja By Jitendra Dewangan </footer>
      </div>
  );
}
