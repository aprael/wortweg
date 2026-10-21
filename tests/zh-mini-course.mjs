// Kleiner synthetischer Deutsch→Chinesisch-Kurs nur für Tests (eigene Inhalte, CC0).
// Unabhängig von den Datenkursen in data/courses. Jeder Aufruf liefert ein frisches Objekt.

const w = (native, target, reading, tags) => ({ native, target, reading, ...(tags ? { tags } : {}) });
const s = (native, target, tokens, reading, note, extra = {}) => ({ native, target, tokens, reading, note, ...extra });

export function zhCourse() {
  return {
    id: 'de-zh-test',
    title: 'Chinesisch (Test)',
    nativeLang: 'de',
    targetLang: 'zh',
    ttsLang: 'zh-CN',
    license: 'CC0-1.0',
    attribution: [{ name: 'Eigene Testinhalte', url: 'https://example.org/wortweg', license: 'CC0-1.0', usage: 'Tests' }],
    generated: false,
    levels: [
      {
        id: 'zh1',
        title: 'Grundlagen',
        units: [
          {
            id: 'zh1-hallo',
            title: 'Begrüßung',
            words: [
              w(['Hallo'], ['你好'], 'nǐhǎo', ['hsk3-1', 'hsk2-1']),
              w(['danke'], ['谢谢', '多谢'], 'xièxie', ['hsk3-1']),
              w(['Tschüss', 'auf Wiedersehen'], ['再见'], 'zàijiàn'),
              w(['Lehrer', 'Lehrerin'], ['老师'], 'lǎoshī'),
              w(['Schüler', 'Schülerin'], ['学生'], 'xuésheng'),
            ],
            sentences: [
              s(['Ich bin Schüler.'], ['我是学生。'], ['我', '是', '学生'], 'wǒ shì xuésheng.', '„是“ (shì) verbindet wie „sein“.'),
              s(['Bist du Lehrer?'], ['你是老师吗？'], ['你', '是', '老师', '吗'], 'nǐ shì lǎoshī ma?', '„吗“ am Satzende macht eine Ja/Nein-Frage.'),
              s(['Danke dir!'], ['谢谢你！'], ['谢谢', '你'], 'xièxie nǐ!', 'Das Objekt steht nach dem Verb.',
                { source: { name: 'Eigene Testinhalte', id: 't-1', url: 'https://example.org/wortweg/t-1' } }),
              s(['Auf Wiedersehen, Lehrer!'], ['老师，再见！'], ['老师', '再见'], 'lǎoshī, zàijiàn!', 'Die Anrede steht vorn.'),
            ],
          },
          {
            id: 'zh1-essen',
            title: 'Essen',
            words: [
              w(['Tee'], ['茶'], 'chá'),
              w(['Wasser'], ['水'], 'shuǐ'),
              w(['Reis'], ['米饭'], 'mǐfàn'),
              w(['trinken'], ['喝'], 'hē'),
              w(['Tochter'], ['女儿'], 'nǚ\'ér'),
            ],
            sentences: [
              s(['Ich trinke Tee.'], ['我喝茶。'], ['我', '喝', '茶'], 'wǒ hē chá.', 'Subjekt – Verb – Objekt.'),
              s(['Isst du Reis?'], ['你吃米饭吗？'], ['你', '吃', '米饭', '吗'], 'nǐ chī mǐfàn ma?', '„吃“ (chī) = essen.'),
              s(['Er trinkt kein Wasser.'], ['他不喝水。'], ['他', '不', '喝', '水'], 'tā bù hē shuǐ.', '„不“ verneint vor dem Verb.'),
              s(['Wir essen Reis.'], ['我们吃米饭。'], ['我们', '吃', '米饭'], 'wǒmen chī mǐfàn.', '„们“ macht den Plural bei Personen.'),
            ],
          },
        ],
      },
      {
        id: 'zh2',
        title: 'Zahlen',
        units: [
          {
            id: 'zh2-zahlen',
            title: 'Zahlen',
            words: [w(['eins'], ['一'], 'yī'), w(['zwei'], ['二'], 'èr'), w(['drei'], ['三'], 'sān'), w(['vier'], ['四'], 'sì')],
            sentences: [
              s(['Ich habe drei Bücher.'], ['我有三本书。'], ['我', '有', '三', '本', '书'], 'wǒ yǒu sān běn shū.', '„本“ ist das Zählwort für Bücher.'),
              s(['Er hat zwei Kinder.'], ['他有两个孩子。'], ['他', '有', '两', '个', '孩子'], 'tā yǒu liǎng ge háizi.', 'Vor Zählwörtern heißt „zwei“ „两“.'),
              s(['Eins, zwei, drei, vier.'], ['一，二，三，四。'], ['一', '二', '三', '四'], 'yī, èr, sān, sì.', 'Zählen von eins bis vier.'),
              s(['Wie viele Bücher hast du?'], ['你有几本书？'], ['你', '有', '几', '本', '书'], 'nǐ yǒu jǐ běn shū?', '„几“ fragt nach kleinen Mengen.'),
            ],
          },
        ],
      },
    ],
  };
}
