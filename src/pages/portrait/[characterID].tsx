import { ClassAttributes, useEffect, useRef, useState } from 'react';
import { Fade, Image } from 'react-bootstrap';
import useSocket, { SocketIO } from '../../hooks/useSocket';
import styles from '../../styles/modules/Portrait.module.scss';
import config from '../../../openrpg.config.json';
import { GetServerSidePropsContext, InferGetServerSidePropsType } from 'next';
import prisma from '../../utils/database';
import { DiceResult, ResolvedDice, sleep } from '../../utils';

export default function CharacterPortrait(props: InferGetServerSidePropsType<typeof getServerSideProps>): JSX.Element {
    const [attributes, setAttributes] = useState(props.attributes);
    const [sideAttribute, setSideAttribute] = useState(props.sideAttribute);
    const [playerName, setPlayerName] = useState(props.playerName.value);
    const [environment, setEnvironment] = useState(props.environment);

    const diceQueue = useRef<DiceResult[]>([]);
    const diceData = useRef<DiceResult>();

    const [showDice, setShowDice] = useState(false);
    const showDiceRef = useRef(showDice);
    showDiceRef.current = showDice;

    const [diceResult, setDiceResult] = useState(0);
    const [diceResultShow, setDiceResultShow] = useState(false);
    const [diceDescription, setDiceDescription] = useState('');
    const [diceDescriptionShow, setDiceDescriptionShow] = useState(false);

    const diceVideo = useRef<HTMLVideoElement>(null);

    const statusID = props.attributeStatus.find(stat => stat.value);
    const [src, setSrc] = useState(`/api/sheet/player/avatar/${statusID}`);
    const previousStatusID = useRef(statusID);

    useSocket(socket => {
        socket.emit('roomJoin', `portrait${props.playerId}`);

        socket.on('configChange', (key, value) => {
            if (key !== 'environment') return;
            setEnvironment(value);
        });

        socket.on('attributeChange', (playerId, attributeId, value, maxValue) => {
            if (playerId !== props.playerId) return;

            setAttributes(attributes => {
                const index = attributes.findIndex(attr => attr.Attribute.id === attributeId);
                if (index === -1) return attributes;

                const newAttributes = [...attributes];

                if (value !== null) newAttributes[index].value = value;
                if (maxValue !== null) newAttributes[index].maxValue = maxValue;

                return newAttributes;
            });

            setSideAttribute(attr => {
                if (attributeId !== attr.Attribute.id) return attr;
                return {
                    value: value || attr.value,
                    Attribute: { ...attr.Attribute }
                };
            });
        });

        socket.on('infoChange', (playerId, infoId, value) => {
            if (playerId !== props.playerId || infoId !== props.playerName.info_id) return;
            setPlayerName(value);
        });

        function showDiceRoll() {
            if (showDiceRef.current) return;
            if (diceVideo.current) {
                setShowDice(true);
                diceVideo.current.currentTime = 0;
                diceVideo.current.play();
            }
        }

        async function hideDiceRoll() {
            setDiceResultShow(false);
            setDiceDescriptionShow(false);
            setShowDice(false);
            await sleep(600);
            setDiceResult(0);
            setDiceDescription('');
        }

        socket.on('diceRoll', showDiceRoll);

        function showDiceResult(roll: number, description: string) {
            setDiceResult(roll);
            setDiceResultShow(true);
            setTimeout(() => {
                setDiceDescription(description);
                setDiceDescriptionShow(true);
            }, 750);
        }

        async function showNextResult(playerId: number, dices: ResolvedDice[], results: DiceResult[]) {
            showDiceRoll();
            await sleep(1000);
            onDiceResult(playerId, dices, results);
        }

        async function onDiceResult(playerId: number, dices: ResolvedDice[], results: DiceResult[]) {
            if (playerId !== props.playerId || results.length === 0) return;

            const result = results[0];

            if (diceData.current) return diceQueue.current.push(result);
            if (!showDiceRef.current) return showNextResult(playerId, dices, results);

            diceData.current = result;
            showDiceResult(result.roll, result.description || '');
            await sleep(3000);
            await hideDiceRoll();
            diceData.current = undefined;

            const next = diceQueue.current.shift();
            if (next) showNextResult(playerId, dices, [next]);
        }

        socket.on('diceResult', onDiceResult);
    });

    useEffect(() => { document.body.style.backgroundColor = 'transparent'; }, []);

    useEffect(() => {
        if (statusID === previousStatusID.current) return;
        previousStatusID.current = statusID;
        setSrc(`/api/sheet/player/avatar/${statusID}?v=${Date.now()}`);
    }, [statusID]);

    return (
        <>
            <div className={`${styles.container}${showDice ? ' show' : ''} shadow`}>
                <Image src='/frame.png' alt='Frame' width={440} height={620} className={styles.frame} />
                <Image src={src} onError={() => setSrc('/avatar404.png')} alt='Avatar' width={420} height={600} className={styles.avatar} />
            </div>
            <div className={styles.sideContainer}>
                <div className={`${styles.side} portrait-color ${sideAttribute.Attribute.name}`}>
                    {sideAttribute.value}
                </div>
            </div>
            <Fade in={environment === 'combat'}>
                <div className={styles.combat}>
                    {attributes.map(attr =>
                        <div className={`${styles.attribute} portrait-color ${attr.Attribute.name}`}
                            key={attr.Attribute.id}>
                            {attr.value}/{attr.maxValue}
                        </div>
                    )}
                </div>
            </Fade>
            <Fade in={environment === 'idle'}>
                <div className={styles.nameContainer}>{playerName || 'Desconhecido'}</div>
            </Fade>
            <div className={styles.diceContainer}>
                <video height="240" muted className={`popout${showDice ? ' show' : ''}`} ref={diceVideo}>
                    <source src="/dice_animation.webm" />
                </video>
                <Fade in={diceResultShow}><div className={styles.result}>{diceResult}</div></Fade>
                <Fade in={diceDescriptionShow}><div className={styles.description}>{diceDescription}</div></Fade>
            </div>
        </>
    );
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
    const id = parseInt(ctx.query.characterID as string);

    const results = await Promise.all([
        prisma.config.findUnique({ where: { key: 'environment' } }),
        prisma.playerAttribute.findMany({
            where: { Attribute: { name: { in: config.portrait.attributes } }, player_id: id },
            select: { value: true, maxValue: true, Attribute: { select: { id: true, name: true } } }
        }),
        prisma.playerAttribute.findFirst({
            where: { Attribute: { name: config.portrait.side_attribute }, player_id: id },
            select: { value: true, Attribute: { select: { id: true, name: true } } }
        }),
        prisma.playerAttributeStatus.findMany({
            where: { player_id: id },
            select: { value: true, AttributeStatus: { select: { id: true } } }
        }),
        prisma.playerInfo.findFirst({ where: { player_id: id, Info: { name: 'Nome' } }, select: { value: true, info_id: true } })
    ]);

    return {
        props: {
            playerId: id,
            environment: results[0]?.value || 'unknown',
            attributes: results[1],
            sideAttribute: results[2] || { value: 0, Attribute: { id: 0, name: '' } },
            attributeStatus: results[3],
            playerName: results[4] || { value: 'Desconhecido', info_id: 0 }
        }
    };
}