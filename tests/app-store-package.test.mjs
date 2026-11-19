import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

// docs/app-store/ is pasted into App Store Connect as is: keep it within Apple's field limits, keep the privacy answers in
// step with the privacy manifest that ships in the app, and keep the screenshots at sizes App Store Connect accepts.
const doc = (name) => readFileSync(new URL(`../docs/app-store/${name}`, import.meta.url), "utf8");
const section = (text, heading) => {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, heading);
  const body = text.slice(start + heading.length + 5);
  return body.slice(0, body.search(/\n## |$/)).trim();
};

test("App Store metadata fits Apple's limits in every language", () => {
  const files = { en: ["Name", "Subtitle", "Keywords", "Promotional text", "Description", "What's New (1.0)"], "zh-Hans": ["名称", "副标题", "关键词", "推广文本", "描述", "新内容（1.0）"], es: ["Nombre", "Subtítulo", "Palabras clave", "Texto promocional", "Descripción", "Novedades (1.0)"] };
  for (const [language, [name, subtitle, keywords, promo, description, whatsNew]] of Object.entries(files)) {
    const text = doc(`metadata.${language}.md`);
    const length = (value) => [...value].length;
    assert.ok(length(section(text, name)) <= 30, `${language} name`);
    assert.ok(length(section(text, subtitle)) <= 30, `${language} subtitle`);
    const words = section(text, keywords);
    assert.ok(Buffer.byteLength(words, "utf8") <= 100, `${language} keywords ${Buffer.byteLength(words, "utf8")} bytes`);
    assert.doesNotMatch(words, /,\s|\s,/, `${language} keywords: commas without spaces`);
    assert.ok(length(section(text, promo)) <= 170, `${language} promotional text`);
    assert.ok(length(section(text, description)) <= 4000, `${language} description`);
    assert.ok(length(section(text, whatsNew)) <= 4000, `${language} what's new`);
    // The description names the third-party AI and the 18+ audience, and links the terms and privacy policy.
    assert.match(section(text, description), /OpenAI/);
    assert.match(section(text, description), /18/);
    assert.match(section(text, description), /\/terms/);
    assert.match(section(text, description), /\/privacy/);
  }
});

test("the privacy label answers list exactly the data types in the shipped privacy manifest", () => {
  const manifest = readFileSync(new URL("../mobile/ios/App/App/PrivacyInfo.xcprivacy", import.meta.url), "utf8");
  const shipped = [...manifest.matchAll(/<string>(NSPrivacyCollectedDataType(?!Purpose)\w+)<\/string>/g)].map((match) => match[1]).sort();
  const answered = [...doc("privacy-nutrition-label.md").matchAll(/`(NSPrivacyCollectedDataType\w+)`/g)].map((match) => match[1]).sort();
  assert.deepEqual(answered, shipped);
});

test("screenshots, when generated, are at sizes App Store Connect accepts for iPhone", () => {
  const root = new URL("../docs/app-store/screenshots/", import.meta.url);
  if (!existsSync(root)) return;
  const accepted = { "6.3": [1206, 2622], "6.9": [1320, 2868] };
  for (const language of readdirSync(root).filter((name) => ["en", "zh", "es"].includes(name))) {
    for (const size of readdirSync(new URL(`${language}/`, root))) {
      assert.ok(accepted[size], `${language}/${size}`);
      const shots = readdirSync(new URL(`${language}/${size}/`, root)).filter((name) => name.endsWith(".png"));
      assert.ok(shots.length >= 3 && shots.length <= 10, `${language}/${size}: ${shots.length} screenshots`);
      for (const shot of shots) {
        const png = readFileSync(new URL(`${language}/${size}/${shot}`, root));
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], accepted[size], `${language}/${size}/${shot}`);
      }
    }
  }
});
