-- DBunny MySQL 테스트 데이터 초기화
-- Docker 컨테이너 최초 기동 시 자동 실행

USE mydb;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(200),
    age INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT,
    published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    user_id INT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
    post_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (post_id, tag_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Seed data
INSERT INTO users (name, email, age) VALUES
    ('Alice', 'alice@example.com', 28),
    ('Bob', 'bob@example.com', 34),
    ('Charlie', 'charlie@example.com', 22),
    ('Diana', 'diana@example.com', 31),
    ('Eve', 'eve@example.com', 27);

INSERT INTO posts (user_id, title, content, published) VALUES
    (1, 'Getting Started with MySQL', 'MySQL is a popular open-source relational database...', TRUE),
    (1, 'Advanced SQL Queries', 'Learn about JOINs, subqueries, and window functions...', TRUE),
    (2, 'Database Indexing Tips', 'Proper indexing can dramatically improve query performance...', TRUE),
    (3, 'NoSQL vs SQL', 'When should you choose NoSQL over SQL databases?', FALSE),
    (4, 'Data Migration Strategies', 'Best practices for migrating data between databases...', TRUE);

INSERT INTO comments (post_id, user_id, body) VALUES
    (1, 2, 'Great introduction! Very helpful.'),
    (1, 3, 'Could you add more examples?'),
    (2, 4, 'The window functions section was excellent.'),
    (3, 1, 'I found this very useful for my project.'),
    (3, 5, 'Please add benchmarks!');

INSERT INTO tags (name) VALUES
    ('mysql'), ('database'), ('sql'), ('tutorial'), ('performance');

INSERT INTO post_tags (post_id, tag_id) VALUES
    (1, 1), (1, 2), (1, 4),
    (2, 3), (2, 4),
    (3, 2), (3, 5),
    (4, 2), (4, 3),
    (5, 2);
