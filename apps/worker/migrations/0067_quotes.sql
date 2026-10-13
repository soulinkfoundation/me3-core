CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    text TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    source TEXT,
    source_url TEXT,
    areas TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(areas)),
    origin TEXT NOT NULL CHECK (origin IN ('core', 'owner', 'agent')),
    saved_at TEXT,
    archived_at TEXT,
    UNIQUE(user_id, text, author)
  );

CREATE TABLE IF NOT EXISTS daily_quotes (
    user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
    date_key TEXT NOT NULL,
    quote_id TEXT NOT NULL REFERENCES quotes(id),
    seen_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY(user_id, date_key)
  );

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q009', 'If you are distressed by anything external, the pain is not due to the thing itself, but to your estimate of it; and this you have the power to revoke at any moment.', 'Marcus Aurelius', 'Meditations 8.47 (George Long translation)', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q022', 'I never think of the future. It comes soon enough.', 'Albert Einstein', 'Interview, 1930', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q031', 'Pay attention to your enemies, for they are the first to discover your mistakes.', 'Antisthenes', 'Diogenes Laertius, Lives 6.12', '["work"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q046', 'Let us endeavor so to live that when we come to die even the undertaker will be sorry.', 'Mark Twain', 'Pudd''nhead Wilson (1894)', '["joy"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q054', 'The unexamined life is not worth living.', 'Socrates', 'Plato, Apology 38a', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q058', 'Society is always taken by surprise at any new example of common sense.', 'Ralph Waldo Emerson', 'Literary Ethics (1838)', '["work"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q068', 'Anyone who has no need of anybody but himself is either a beast or a God.', 'Aristotle', 'Politics 1253a (paraphrase)', '["home"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q088', 'A ship is safe in harbor, but that''s not what ships are for.', 'John A. Shedd', 'Salt from My Attic (1928)', '["joy","work"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q091', 'Whoever knows the All but fails to know himself lacks everything.', 'Gospel of Thomas', 'Gospel of Thomas, saying 67', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q098', 'The mind is its own place, and in itself can make a heaven of hell, a hell of heaven.', 'John Milton', 'Paradise Lost, Book 1', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q121', 'What does not benefit the hive is no benefit to the bee.', 'Marcus Aurelius', 'Meditations 6.54 (George Long translation)', '["home","work"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q125', 'For the strength of the Pack is the Wolf, and the strength of the Wolf is the Pack.', 'Rudyard Kipling', 'The Law of the Jungle, The Second Jungle Book (1895)', '["home"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q150', 'He who has a Why to live for can bear almost any How.', 'Friedrich Nietzsche', 'Twilight of the Idols (1889)', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q153', 'The most useful piece of learning for the uses of life is to unlearn what is untrue.', 'Antisthenes', 'Diogenes Laertius, Lives 6.7', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q155', 'There are more things, Lucilius, that frighten us than inspire us, and we suffer more in imagination than in reality.', 'Seneca', 'Letters 13 (Gummere translation)', '["spirituality","health"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q164', 'The secret of success is constancy to purpose.', 'Benjamin Disraeli', 'Speech, 1872', '["work"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q165', 'The crowning fortune of a man is to be born to some pursuit which finds him employment and happiness, whether it be to make baskets, or broadswords, or canals, or statues, or songs.', 'Ralph Waldo Emerson', 'The Conduct of Life (1860)', '["work","joy"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q191', 'It isn''t what you have or who you are or where you are or what you are doing that makes you happy or unhappy. It is what you think about it.', 'Dale Carnegie', 'How to Win Friends and Influence People (1936)', '["joy"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q197', 'The important thing is not to stop questioning. Curiosity has its own reason for existing.', 'Albert Einstein', 'LIFE interview, 1955', '["joy"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q198', 'The most beautiful thing we can experience is the mysterious. It is the source of all true art and all science. He to whom this emotion is a stranger, who can no longer pause to wonder and stand rapt in awe, is as good as dead: his eyes are closed.', 'Albert Einstein', 'The World as I See It (1931)', '["joy","spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q205', 'Action may not always bring happiness; but there is no happiness without action.', 'Benjamin Disraeli', 'Lothair (1870)', '["joy","work"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q212', 'Knowledge is the antidote to fear.', 'Ralph Waldo Emerson', 'Society and Solitude (1870)', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q216', 'Very little is needed to make a happy life; it is all within yourself in your way of thinking.', 'Marcus Aurelius', 'Meditations 7.67 (paraphrase)', '["joy"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q227', 'Do not spoil what you have by desiring what you have not; remember that what you now have was once among the things you only hoped for.', 'Epicurus', 'Vatican Sayings 35', '["finances","joy"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q321', 'I am the master of my fate, I am the captain of my soul.', 'William Ernest Henley', 'Invictus (1875)', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q371', 'After the final no there comes a yes.', 'Wallace Stevens', 'The Well Dressed Man with a Beard (1941)', '["spirituality"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q378', 'Creation is a better means of self-expression than possession; it is through creating, not possessing, that life is revealed.', 'Vida D. Scudder', 'The Life of the Spirit in the Modern English Poets (1895)', '["finances","joy"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q408', 'How much pain have cost us the evils which have never happened.', 'Thomas Jefferson', 'Letter to Thomas Jefferson Smith (1825)', '["health"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q492', 'Imagination is more important than knowledge.', 'Albert Einstein', 'Saturday Evening Post interview, 1929', '["work","joy"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q507', 'Great spirits have often encountered violent opposition from weak minds.', 'Albert Einstein', 'Letter about Bertrand Russell, 1940', '["work"]', 'core');

INSERT OR IGNORE INTO quotes (id, text, author, source, areas, origin) VALUES ('q545', 'A human being is a part of a whole, called by us universe, a part limited in time and space. He experiences himself, his thoughts and feelings as something separated from the rest... a kind of optical delusion of his consciousness. This delusion is a kind of prison for us, restricting us to our personal desires and to affection for a few persons nearest to us. Our task must be to free ourselves from this prison by widening our circle of compassion to embrace all living creatures and the whole of nature in its beauty.', 'Albert Einstein', 'Letter, 1950', '["spirituality","home"]', 'core');
