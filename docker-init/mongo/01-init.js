// DBunny MongoDB 테스트 데이터 초기화
// Docker 컨테이너 최초 기동 시 자동 실행

db = db.getSiblingDB('mydb');

// users
db.users.drop();
db.users.insertMany([
    { name: 'Alice', email: 'alice@example.com', age: 28, tags: ['admin', 'developer'] },
    { name: 'Bob', email: 'bob@example.com', age: 34, tags: ['developer'] },
    { name: 'Charlie', email: 'charlie@example.com', age: 22, tags: ['designer'] },
    { name: 'Diana', email: 'diana@example.com', age: 31, tags: ['developer', 'devops'] },
    { name: 'Eve', email: 'eve@example.com', age: 27, tags: ['pm'] }
]);

// posts
db.posts.drop();
db.posts.insertMany([
    { author: 'Alice', title: 'Getting Started with MongoDB', content: 'MongoDB is a document-oriented NoSQL database...', published: true, tags: ['mongodb', 'tutorial'], createdAt: new Date() },
    { author: 'Alice', title: 'Aggregation Pipeline Guide', content: 'Learn about $match, $group, $project...', published: true, tags: ['mongodb', 'advanced'], createdAt: new Date() },
    { author: 'Bob', title: 'Indexing Best Practices', content: 'Create indexes on fields you frequently query...', published: true, tags: ['mongodb', 'performance'], createdAt: new Date() },
    { author: 'Charlie', title: 'Schema Design Patterns', content: 'Embedding vs referencing in MongoDB...', published: false, tags: ['mongodb', 'design'], createdAt: new Date() },
    { author: 'Diana', title: 'MongoDB Atlas Setup', content: 'How to deploy MongoDB on the cloud...', published: true, tags: ['mongodb', 'devops'], createdAt: new Date() }
]);

// products (다양한 타입 테스트)
db.products.drop();
db.products.insertMany([
    { name: 'Laptop', price: 1299.99, category: 'electronics', inStock: true, specs: { cpu: 'i7', ram: 16, storage: 512 } },
    { name: 'Keyboard', price: 89.99, category: 'electronics', inStock: true, specs: { type: 'mechanical', switches: 'cherry-mx' } },
    { name: 'Notebook', price: 4.99, category: 'stationery', inStock: true, specs: null },
    { name: 'Monitor', price: 549.99, category: 'electronics', inStock: false, specs: { size: 27, resolution: '4K' } },
    { name: 'Pen', price: 1.99, category: 'stationery', inStock: true, specs: null }
]);

print('MongoDB init complete: mydb (users, posts, products)');
