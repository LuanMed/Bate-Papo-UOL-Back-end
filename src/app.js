import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import Joi from "joi";
import dayjs from "dayjs";
import { MongoClient, ObjectId } from "mongodb";
import { stripHtml } from "string-strip-html";
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const mongoClient = new MongoClient(process.env.DATABASE_URL);
let db;

try {
    await mongoClient.connect();
    db = mongoClient.db();
    console.log("MongoDB Connected!");
} catch (err) {
    console.log(err.message);
}

app.post('/participants', async (req, res) => {
    const { name } = req.body;

    const schema = Joi.object({
        username: Joi.string().required()
    })

    if (schema.validate({ username: name }).error) {
        return res.status(422).send("Nome inválido!")
    }

    const treatedName = stripHtml(name.trim()).result;
    console.log(treatedName);

    try {
        const userExist = await db.collection("participants").findOne({ name: treatedName });

        if (userExist) return res.status(409).send("Usuário já cadastrado!");

        await db.collection("participants").insertOne({
            name: treatedName,
            lastStatus: Date.now()
        });

        await db.collection("messages").insertOne({
            from: treatedName,
            to: "Todos",
            text: 'entra na sala...',
            type: 'status',
            time: dayjs().format('HH:mm:ss')
        });

        res.sendStatus(201);
    } catch (err) {
        res.status(500).send(err.message);
    }
    res.status(201);
});

app.get('/participants', async (req, res) => {

    try {
        const participants = await db.collection("participants").find().toArray();
        res.send(participants);
    } catch (err) {
        res.status(500).send(err.message);
    }
})

app.post('/messages', async (req, res) => {
    const { to, text, type } = req.body;

    const from = req.headers.user;
    console.log(from);

    const schema = Joi.object({
        to: Joi.string().required(),
        text: Joi.string().required(),
        type: Joi.any().valid('message', 'private_message').required()
    })

    if (schema.validate({ to: to, text: text, type: type }).error) {
        return res.status(422).send("Preencha os campos corretamente!");
    }

    const treatedText = stripHtml(text.trim()).result;

    try {
        const isLogged = await db.collection("participants").findOne({ name: from });

        if (!isLogged) return res.status(422).send("Usuário não está logado!");

        await db.collection("messages").insertOne({
            from,
            to,
            text: treatedText,
            type,
            time: dayjs().format('HH:mm:ss')
        })
        res.status(201).send("ok");
    } catch (err) {
        return res.status(500).send(err.message);
    }
})

app.get('/messages', async (req, res) => {
    const { limit } = req.query;
    const { user } = req.headers;

    const schema = Joi.object({
        limit: Joi.number().greater(0)
    })

    if (schema.validate({ limit: limit }).error) {
        return res.sendStatus(422);
    }

    try {
        const messages = await db.collection("messages").find().toArray();
        //console.log(messages)
        const filterMessages = messages.filter(message =>
            message.type !== "private_message" ||
            (message.type === "private_message" &&
                (message.to === user || message.to === "Todos" || message.from === user)
            ));

        if (limit) {
            const lastMessages = filterMessages.slice(-limit);
            return res.send(lastMessages.reverse());
        }
        res.send(filterMessages);
    } catch (err) {
        res.status(500).send(err.message);
        console.log("erro no get messages")
    }
});

app.put('/messages/:id', async (req, res) => {
    const { to, text, type } = req.body;

    const from = req.headers.user;
    const { id } = req.params;

    const schema = Joi.object({
        to: Joi.string().required(),
        text: Joi.string().required(),
        type: Joi.any().valid('message', 'private_message').required()
    })

    if (schema.validate({ to: to, text: text, type: type }).error) {
        return res.status(422).send("Preencha os campos corretamente!");
    }

    const treatedText = stripHtml(text.trim()).result;

    try {
        const isLogged = await db.collection("participants").findOne({ name: from });

        if (!isLogged) return res.status(422).send("Usuário não está logado!");

        const message = await db.collection("messages").findOne({ _id: ObjectId(id) });
        if (!message) return res.sendStatus(404);

        if (message.from !== from) return res.sendStatus(401);

        await db.collection("messages").updateOne({ _id: ObjectId(id) }, {
            $set: {
                from,
                to,
                text: treatedText,
                type,
                time: dayjs().format('HH:mm:ss')
            }
        });
        res.sendStatus(200)
    } catch (err) {
        res.sendStatus(500);
    }
})

app.delete('/messages/:id', async (req, res) => {
    const { user } = req.headers;
    const { id } = req.params;

    try {
        const message = await db.collection("messages").findOne({ _id: ObjectId(id) });
        console.log(message);
        if (!message) return res.sendStatus(404);

        if (message.from !== user) return res.sendStatus(401);

        await db.collection("messages").deleteOne({ _id: ObjectId(id) });
        res.sendStatus(200)
    } catch (err) {
        res.sendStatus(500);
    }
})

app.post('/status', async (req, res) => {
    const name = req.headers.user;

    try {
        const isLogged = await db.collection("participants").findOne({ name });

        if (!isLogged) return res.sendStatus(404);

        const user = await db.collection("participants").findOneAndUpdate(
            { name: name }, { $set: { lastStatus: Date.now() } }, { returnNewDocument: true }
        );
        //console.log(user);
        if (!user) return res.sendStatus(404);

        res.sendStatus(200);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

async function removeInactive() {

    try {
        const users = await db.collection("participants").find().toArray();
        //console.log(users);
        const inactive = users.filter(user => Date.now() - Number(user.lastStatus) >= 10000);
        inactive.map(async function (user) {
            await db.collection("messages").insertOne({
                from: user.name,
                to: "Todos",
                text: "sai da sala...",
                type: "status",
                time: dayjs().format('HH:mm:ss')
            })
            await db.collection("participants").deleteOne({ name: user.name })
        })

    } catch (err) {
        console.log(err);
    }
}

setInterval(removeInactive, 15000);

const PORT = 5000;

app.listen(PORT, () => console.log(`Servidor rodou na porta: ${PORT}`));