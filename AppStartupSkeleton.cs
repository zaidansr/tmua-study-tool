using System.Drawing.Drawing2D;
using System.ComponentModel;

namespace TmuaDesktop;

internal sealed class StartupSkeleton : Control
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 40 };
    private readonly Font body = new("Segoe UI",10), small = new("Segoe UI",8), brand = new("Segoe UI",16,FontStyle.Bold);
    private int frame;
    private bool darkMode;
    private string statusText = "Loading questions…";
    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    internal bool DarkMode { get => darkMode; set { darkMode=value; Invalidate(); } }
    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    internal string StatusText { get => statusText; set { statusText=value; Invalidate(); } }

    internal StartupSkeleton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer,true);
        AccessibleRole=AccessibleRole.ProgressBar; AccessibleName="Loading the question bank"; TabStop=false;
        timer.Tick+=(_,_)=>{frame=(frame+1)%60;Invalidate();};
    }
    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);timer.Enabled=Visible&&SystemInformation.UIEffectsEnabled;
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g=e.Graphics;g.SmoothingMode=SmoothingMode.AntiAlias;
        var paper=DarkMode?Color.FromArgb(23,23,23):Color.White;
        var surface=DarkMode?Color.FromArgb(30,30,30):Color.FromArgb(247,247,247);
        var ink=DarkMode?Color.FromArgb(239,239,239):Color.FromArgb(23,23,23);
        var muted=DarkMode?Color.FromArgb(176,176,176):Color.FromArgb(96,96,96);
        var line=DarkMode?Color.FromArgb(70,70,70):Color.FromArgb(216,216,216);
        var fill=DarkMode?Color.FromArgb(48,48,48):Color.FromArgb(235,235,235);
        var blocks=new List<RectangleF>();g.Clear(paper);
        void Area(Color c,float x,float y,float w,float h){using var b=new SolidBrush(c);g.FillRectangle(b,x,y,Math.Max(0,w),Math.Max(0,h));}
        void Text(string text,float x,float y,float width,Font? font=null,bool secondary=false){using var b=new SolidBrush(secondary?muted:ink);using var format=new StringFormat{Trimming=StringTrimming.EllipsisCharacter,FormatFlags=StringFormatFlags.NoWrap};g.DrawString(text,font??body,b,new RectangleF(x,y,Math.Max(1,width),28),format);}
        void Block(float x,float y,float w,float h){if(w>0)blocks.Add(new(x,y,w,h));}
        void Rule(float x,float y,float w){using var p=new Pen(line);g.DrawLine(p,x,y,x+Math.Max(0,w),y);}
        void Box(float x,float y,float w,float h,int radius=5){using var path=new GraphicsPath();float d=radius*2;path.AddArc(x,y,d,d,180,90);path.AddArc(x+w-d,y,d,d,270,90);path.AddArc(x+w-d,y+h-d,d,d,0,90);path.AddArc(x,y+h-d,d,d,90,90);path.CloseFigure();using var b=new SolidBrush(paper);g.FillPath(b,path);using var p=new Pen(line);g.DrawPath(p,path);}
        float width=Width, header=width>=1024?92:140, side=width>=1024?274:0;
        float gutter=Math.Clamp(width*.04f,24,64), left=side+gutter, right=width-gutter;
        // The same header and navigation as the study screen.
        float logoX=width*.041f;
        using(var b=new SolidBrush(ink))g.FillEllipse(b,logoX,22,46,46);
        using(var b=new SolidBrush(paper)){g.FillEllipse(b,logoX+20,31,6,6);g.FillEllipse(b,logoX+14,48,6,6);g.FillEllipse(b,logoX+26,48,6,6);}
        Text("TMUA",logoX+58,24,110,brand);Text("QUESTION BANK",logoX+58,52,130,small);
        float nav=width>=1024?logoX+194:24, navY=width>=1024?35:102;
        foreach(var item in new[]{("Practice",82f),("Random mode",124f),("Test mode",92f),("Papers & sources",160f)}){Text(item.Item1,nav,navY,item.Item2,body,item.Item1!="Practice");if(item.Item1=="Practice")Area(ink,nav,navY+33,58,2);nav+=item.Item2;}
        Box(width-logoX-118,22,118,44);Text("Dark mode",width-logoX-98,35,96,small);
        Rule(0,header,width);
        if(side>0)
        {
            Area(surface,0,header,side,Height-header);using(var p=new Pen(line))g.DrawLine(p,side,header,side,Height);
            Text("Filters",20,header+29,100,small);Text("Clear filters",side-96,header+29,90,small,true);
            Box(20,header+87,side-40,48);Block(42,header+105,side-95,12);
            Text("Paper",20,header+160,100,small);Box(20,header+185,side-40,44);Block(32,header+201,side-64,12);
            float y=header+250;
            foreach(var label in new[]{"Year","Topic","Progress"}){Text(label,20,y,120,small,true);Box(20,y+27,side-40,44);Block(33,y+44,side-98,11);y+=86;}
            Rule(20,y+4,side-40);Text("Questions",20,y+25,100,small);Block(94,y+29,28,12);
            for(int i=0;i<6;i++){float row=y+68+i*62;Block(30,row,28,30);Block(70,row+2,100,11);Block(70,row+20,130,10);}
        }
        else
        {
            Box(24,header+16,width-48,48);Block(44,header+33,width*.55f,12);
            Box(24,header+76,width-48,44);Text("Filters & question list",36,header+89,width-80,small,true);
        }
        float top=side>0?header+24:header+148;
        float countX=left;
        foreach(var label in new[]{"questions","papers","attempted"}){Block(countX,top+14,28,14);Text(label,countX+38,top+10,86,small,true);countX+=label=="questions"?136:122;}
        if(right-left>660)Text(StatusText,right-230,top+10,230,small,true);
        float cardY=top+62, cardW=right-left, bodyX=left+24, bodyW=cardW-48;
        Box(left,cardY,cardW,Math.Max(900,Height-cardY+120),10);
        Block(bodyX,cardY+26,46,24);Block(bodyX+56,cardY+26,56,24);Block(bodyX+124,cardY+31,100,14);
        Block(right-170,cardY+32,44,12);Box(right-102,cardY+16,78,44);Block(right-82,cardY+32,38,12);Rule(left,cardY+76,cardW);
        float topicY=cardY+108;Block(bodyX,topicY,100,11);Block(right-176,topicY,150,11);
        float answersY=topicY+42;Text("YOUR ANSWER",bodyX,answersY+13,100,small,true);
        float choiceX=bodyX+105;
        for(int i=0;i<6;i++)Block(choiceX+i*52,answersY,44,44);
        float actionX=choiceX+6*52+12;
        if(actionX+300>right-24){answersY+=54;actionX=bodyX;}
        Block(actionX,answersY,146,44);Block(actionX+162,answersY+16,140,12);Rule(bodyX,answersY+56,bodyW);
        float questionY=answersY+98;
        Block(bodyX+20,questionY,22,24);Block(bodyX+88,questionY,bodyW*.70f,22);
        for(int i=1;i<4;i++)Block(bodyX+88,questionY+i*70,bodyW*(i%2==0?.67f:.86f),22);
        for(int i=0;i<5;i++){float y=questionY+280+i*60;Block(bodyX+88,y,18,22);Block(bodyX+140,y,140+i%2*36,22);}
        using(var brush=new SolidBrush(fill))foreach(var block in blocks){using var path=RoundedBlock(block);g.FillPath(brush,path);}
        if(!SystemInformation.UIEffectsEnabled)return;
        float sweepWidth=Math.Max(100,width/3), sweepX=(width+sweepWidth)*frame/60-sweepWidth;
        var sweep=new RectangleF(sweepX,0,sweepWidth,Height);
        using var shimmer=new LinearGradientBrush(sweep,Color.Transparent,Color.White,0f);
        shimmer.InterpolationColors=new ColorBlend{Positions=[0f,.5f,1f],Colors=[Color.Transparent,Color.FromArgb(DarkMode?24:180,255,255,255),Color.Transparent]};
        foreach(var block in blocks){using var path=RoundedBlock(block);g.SetClip(path);g.FillRectangle(shimmer,sweep);g.ResetClip();}
    }
    private static GraphicsPath RoundedBlock(RectangleF bounds)
    {
        float d=Math.Min(12,Math.Min(bounds.Width,bounds.Height));
        var path=new GraphicsPath();
        path.AddArc(bounds.Left,bounds.Top,d,d,180,90);
        path.AddArc(bounds.Right-d,bounds.Top,d,d,270,90);
        path.AddArc(bounds.Right-d,bounds.Bottom-d,d,d,0,90);
        path.AddArc(bounds.Left,bounds.Bottom-d,d,d,90,90);
        path.CloseFigure();return path;
    }
    protected override void Dispose(bool disposing)
    {
        if(disposing){timer.Dispose();body.Dispose();small.Dispose();brand.Dispose();}
        base.Dispose(disposing);
    }
}
