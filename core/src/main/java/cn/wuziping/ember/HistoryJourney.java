package cn.wuziping.ember;

/** A fictional archival quest about checking sources and the spread of printing. */
public final class HistoryJourney {
    public int stage=0; // 0 undiscovered; 1 seek the printer; 2 seek the apprentice; 3 report; 4 complete
    public String objective(){switch(stage){case 1:return "历史 · 到南街找印匠阿榫";case 2:return "历史 · 到水边找书童小满";case 3:return "历史 · 把线索带回给闻简";case 4:return "历史 · 纸上灯火已完成";default:return "寻找书屋旁的史官闻简";}}
    public boolean talk(Game g,int id){
        if(id<10||id>12||!g.inTown()||g.mode!=Game.PLAY)return false;
        if(id==10){
            if(stage==0)g.story.begin(g,id,new String[]{"闻简|我替这座城保管旧事，却丢了一页最重要的记载。有人说它是天上掉下来的，也有人说是一位匠人一刀一刀刻出来的。","伍子平|你想让我猜哪一种？","闻简|我不爱猜。我爱证据。去南街找阿榫，他的手指比我的书还会讲故事。"},new String[]{"接下委托","稍后再来"},new int[]{401,400});
            else if(stage==1||stage==2)g.story.begin(g,id,new String[]{"闻简|口说无凭。带回实物与记录，再来找我。","闻简|"+objective()},new String[]{"继续寻找"},new int[]{400});
            else if(stage==3)g.story.begin(g,id,new String[]{"闻简|一枚泥字、一段记述、一页印本。它们各有来处，也各有看不见的部分。","伍子平|沈括《梦溪笔谈》记载，北宋毕昇用胶泥制作活字。活字印刷让字可以拆开重排。","闻简|好。记得把来源写在灯旁：不是每个流传的故事，都能只凭讲述者的名气作证。","小满|那我也把今天记下来！以后有人问，你们可别说是灯自己亮的。"},new String[]{"点亮纸上灯火 · 领取谢礼"},new int[]{406});
            else g.story.begin(g,id,new String[]{"闻简|灯已经亮了，记录却永远可以被补充。历史不是一张只容得下一个声音的纸。"},new String[]{"记住了"},new int[]{400});
        }else if(id==11){
            if(stage!=1)g.story.begin(g,id,new String[]{"阿榫|我修的是旧版，也修别人撕碎的故事。找闻简吧，他有一页纸正在等你。"},new String[]{"告辞"},new int[]{400});
            else g.story.begin(g,id,new String[]{"阿榫|先别碰这堆泥字！每个字都能拆下来，再排成另一页。雕版要整版重刻，这些小字却能反复组合。","阿榫|我祖上传下来的线索不一定全对，但手里的东西不会自己说谎。你看，换一篇文章，哪样更方便重新排字？"},new String[]{"拆开活字，重新组合","把整块雕版当作活字"},new int[]{402,403});
        }else{
            if(stage!=2)g.story.begin(g,id,new String[]{"小满|我正在替闻简送书！我跑得快，但他的字我还要认半天。"},new String[]{"辛苦了"},new int[]{400});
            else g.story.begin(g,id,new String[]{"小满|这本《梦溪笔谈》里有一段关于毕昇与胶泥活字的记述。闻简说，一个名字如果没有出处，就像没系线的风筝。","小满|阿榫手里有实物，我手里有文字。要弄清楚它们的故事，应该怎么做？"},new String[]{"比较实物、记述与来源","只听最响亮的传言"},new int[]{404,405});
        }return true;
    }
    public void action(Game g,int action){
        if(action==401&&stage==0){stage=1;g.announce(objective());}
        else if(action==402&&stage==1){stage=2;g.story.begin(g,11,new String[]{"阿榫|答对了。字是活动的，手艺也靠人传下去。拿着这枚泥字，去找水边的小满。"},new String[]{"收下泥字"},new int[]{400});}
        else if(action==403&&stage==1)g.story.begin(g,11,new String[]{"阿榫|整块雕版是一版一刻。再看看这些能单独取下的小字，换文章时谁更方便？"},new String[]{"再想一想"},new int[]{400});
        else if(action==404&&stage==2){stage=3;g.story.begin(g,12,new String[]{"小满|没错！不同证据能互相印证，也要记住每种证据都有局限。快回书屋告诉闻简。"},new String[]{"带上记录"},new int[]{400});}
        else if(action==405&&stage==2)g.story.begin(g,12,new String[]{"小满|声音大不代表证据多。阿榫的泥字和书里的记述，不妨一起看看？"},new String[]{"再想一想"},new int[]{400});
        else if(action==406&&stage==3){stage=4;g.gold+=120;g.potions=Math.min(5,g.potions+1);g.announce("纸上灯火 · 120 金币和药剂已领取");}
    }
}
